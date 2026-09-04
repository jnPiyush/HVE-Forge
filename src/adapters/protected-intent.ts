import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ReplacementIntent, RunDescriptor } from "../application/contracts.js";
import { canonicalizeValue, sha256Hex } from "../core/canonical-json.js";
import { assertNoLinks } from "./path-safety.js";
import { CONTROL_DIRECTORY, writeFileAtomic } from "./workspace.js";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const INTENT_FILE = "replacement-intent.bin";

export async function saveReplacementIntent(
  runRoot: string,
  workspaceRoot: string,
  runId: string,
  intent: ReplacementIntent
): Promise<void> {
  const controlRoot = join(resolve(workspaceRoot), CONTROL_DIRECTORY);
  const keyPath = intentKeyPath(runRoot, runId);
  const key = randomBytes(KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const plaintext = Buffer.from(
    canonicalizeValue({
      relativePath: intent.relativePath,
      expectedText: intent.expectedText,
      replacementText: intent.replacementText,
      argumentsHash: intent.argumentsHash
    }),
    "utf8"
  );
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(runId, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const protectedBytes = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    await writeFileAtomic(keyPath, key);
    await writeFileAtomic(join(controlRoot, INTENT_FILE), protectedBytes);
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

export async function loadReplacementIntent(descriptor: RunDescriptor): Promise<ReplacementIntent> {
  const path = join(descriptor.workspaceRoot, CONTROL_DIRECTORY, INTENT_FILE);
  await assertNoLinks(descriptor.workspaceRoot, path);
  const protectedBytes = await readFile(path);
  if (protectedBytes.byteLength <= NONCE_BYTES + TAG_BYTES) {
    throw new Error("Encrypted replacement intent is malformed.");
  }
  const key = await readFile(intentKeyPath(descriptor.runRoot, descriptor.runId));
  if (key.byteLength !== KEY_BYTES) throw new Error("Replacement intent key is invalid.");
  try {
    const nonce = protectedBytes.subarray(0, NONCE_BYTES);
    const tag = protectedBytes.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const ciphertext = protectedBytes.subarray(NONCE_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(descriptor.runId, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext)
    ) as unknown;
    if (!isObject(value)) throw new Error("Replacement intent is invalid.");
    const intent: ReplacementIntent = {
      relativePath: text(value["relativePath"]),
      expectedText: text(value["expectedText"]),
      replacementText:
        typeof value["replacementText"] === "string" ? value["replacementText"] : fail(),
      argumentsHash: text(value["argumentsHash"])
    };
    if (
      intent.relativePath !== descriptor.targetRelativePath ||
      sha256Hex(intent.expectedText) !== descriptor.expectedTextHash ||
      sha256Hex(intent.replacementText) !== descriptor.replacementTextHash ||
      computeArgumentsHash(intent) !== intent.argumentsHash
    ) {
      throw new Error("Replacement intent does not match pinned content hashes.");
    }
    return intent;
  } catch (error) {
    throw new Error("Replacement intent authentication or validation failed.", { cause: error });
  } finally {
    key.fill(0);
  }
}

export function computeArgumentsHash(argumentsValue: {
  readonly relativePath: string;
  readonly expectedText: string;
  readonly replacementText: string;
}): string {
  return sha256Hex(
    canonicalizeValue({
      relativePath: argumentsValue.relativePath,
      expectedText: argumentsValue.expectedText,
      replacementText: argumentsValue.replacementText
    })
  );
}

function intentKeyPath(runRoot: string, runId: string): string {
  const runsRoot = dirname(resolve(runRoot));
  const localStateRoot = dirname(runsRoot);
  return join(localStateRoot, "keys", `${runId}.key`);
}

function text(value: unknown): string {
  if (typeof value !== "string" || value === "") return fail();
  return value;
}

function fail(): never {
  throw new Error("Replacement intent field is invalid.");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
