import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ReplaceTextArguments,
  ToolExecutionContext,
  ToolResult,
  WorkspaceTool
} from "../application/contracts.js";
import type {
  ToolHandler,
  ToolHandlerContext,
  ToolHandlerOutput
} from "../application/tool-dispatcher.js";
import { ToolHandlerError } from "../application/tool-dispatcher.js";
import { canonicalizeValue, type JsonValue, sha256Hex } from "../core/canonical-json.js";
import type { ToolDescriptor } from "../core/tool-registry.js";
import {
  assertNoLinksInAbsolutePath,
  PathSafetyError,
  resolveExistingRegularFile
} from "./path-safety.js";
import { computeTreeHash, writeFileAtomic } from "./workspace.js";

interface ReplacementReceipt {
  readonly schemaVersion: "1.0";
  readonly idempotencyKey: string;
  readonly argumentsHash: string;
  readonly relativePath: string;
  readonly beforeFileHash: string;
  readonly afterFileHash: string;
  readonly status: "prepared" | "completed";
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export const EXACT_TEXT_REPLACE_DESCRIPTOR: ToolDescriptor = Object.freeze({
  toolId: "workspace.replace_exact_text",
  version: "1.0.0",
  capabilityClass: "write",
  bounds: Object.freeze({ maxOutputBytes: 65_536, maxResultCount: 1 })
});

export class ExactTextReplaceTool implements WorkspaceTool {
  public readonly name = "workspace.replace_exact_text";
  public readonly version = "1.0.0";
  public readonly actionClass = "workspace_write" as const;

  public async execute(
    context: ToolExecutionContext,
    argumentsValue: ReplaceTextArguments
  ): Promise<ToolResult> {
    if (
      argumentsValue.expectedText.length === 0 ||
      argumentsValue.expectedText === argumentsValue.replacementText ||
      !IDENTIFIER.test(context.idempotencyKey)
    ) {
      return failure("BAD_ARGUMENTS", "Expected and replacement text must define a safe change.");
    }
    try {
      const target = await resolveExistingRegularFile(
        context.workspaceRoot,
        argumentsValue.relativePath
      );
      const receiptsRoot = join(context.stateRoot, "idempotency");
      await assertNoLinksInAbsolutePath(receiptsRoot);
      await mkdir(receiptsRoot, { recursive: true });
      const receiptPath = join(receiptsRoot, `${context.idempotencyKey}.json`);
      const receipt = await readReceipt(receiptPath);
      if (receipt !== null) {
        return this.reconcile(receipt, receiptPath, target, context, argumentsValue);
      }

      const originalBytes = await readFile(target);
      const original = decodeUtf8(originalBytes);
      const matchCount = countOccurrences(original, argumentsValue.expectedText);
      if (matchCount !== 1) {
        return failure(
          "EXPECTED_TEXT_COUNT",
          `Expected text must occur exactly once; observed ${matchCount}.`
        );
      }
      const replacement = original.replace(
        argumentsValue.expectedText,
        argumentsValue.replacementText
      );
      const replacementBytes = Buffer.from(replacement, "utf8");
      const prepared: ReplacementReceipt = {
        schemaVersion: "1.0",
        idempotencyKey: context.idempotencyKey,
        argumentsHash: context.argumentsHash,
        relativePath: argumentsValue.relativePath.replaceAll("\\", "/"),
        beforeFileHash: sha256Hex(originalBytes),
        afterFileHash: sha256Hex(replacementBytes),
        status: "prepared"
      };
      await writeReceipt(receiptPath, prepared);
      await resolveExistingRegularFile(context.workspaceRoot, argumentsValue.relativePath);
      await writeFileAtomic(target, replacementBytes);
      const completed: ReplacementReceipt = { ...prepared, status: "completed" };
      await writeReceipt(receiptPath, completed);
      return success(completed, await computeTreeHash(context.workspaceRoot), false);
    } catch (error) {
      if (error instanceof PathSafetyError) {
        return failure(`PATH_${error.code.toUpperCase()}`, error.message);
      }
      if (error instanceof TypeError && error.message.includes("UTF-8")) {
        return failure("INVALID_UTF8", "Target file is not valid UTF-8.");
      }
      if (error instanceof SyntaxError) {
        return failure("RECEIPT_INVALID", "Idempotency receipt is malformed.");
      }
      if (isNodeError(error)) return failure("IO_ERROR", error.message);
      throw error;
    }
  }

  private async reconcile(
    receipt: ReplacementReceipt,
    receiptPath: string,
    target: string,
    context: ToolExecutionContext,
    argumentsValue: ReplaceTextArguments
  ): Promise<ToolResult> {
    if (
      receipt.idempotencyKey !== context.idempotencyKey ||
      receipt.argumentsHash !== context.argumentsHash ||
      receipt.relativePath !== argumentsValue.relativePath.replaceAll("\\", "/")
    ) {
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key was used with different arguments.");
    }
    const currentBytes = await readFile(target);
    const currentHash = sha256Hex(currentBytes);
    if (currentHash === receipt.afterFileHash) {
      const completed =
        receipt.status === "completed" ? receipt : { ...receipt, status: "completed" as const };
      if (completed !== receipt) await writeReceipt(receiptPath, completed);
      return success(completed, await computeTreeHash(context.workspaceRoot), true);
    }
    if (receipt.status === "prepared" && currentHash === receipt.beforeFileHash) {
      const current = decodeUtf8(currentBytes);
      if (countOccurrences(current, argumentsValue.expectedText) !== 1) {
        return failure(
          "IDEMPOTENCY_DRIFT",
          "Prepared replacement no longer matches the target file."
        );
      }
      const replacement = Buffer.from(
        current.replace(argumentsValue.expectedText, argumentsValue.replacementText),
        "utf8"
      );
      if (sha256Hex(replacement) !== receipt.afterFileHash) {
        return failure("IDEMPOTENCY_DRIFT", "Prepared replacement hash is inconsistent.");
      }
      await resolveExistingRegularFile(context.workspaceRoot, argumentsValue.relativePath);
      await writeFileAtomic(target, replacement);
      const completed: ReplacementReceipt = { ...receipt, status: "completed" };
      await writeReceipt(receiptPath, completed);
      return success(completed, await computeTreeHash(context.workspaceRoot), true);
    }
    return failure("IDEMPOTENCY_DRIFT", "Workspace state does not match the idempotency receipt.");
  }
}

export class ExactTextReplaceHandler implements ToolHandler {
  public readonly descriptor = EXACT_TEXT_REPLACE_DESCRIPTOR;

  public constructor(private readonly tool = new ExactTextReplaceTool()) {}

  public parseInput(value: unknown): JsonValue {
    const argumentsValue = parseArguments(value);
    return {
      relativePath: argumentsValue.relativePath,
      expectedText: argumentsValue.expectedText,
      replacementText: argumentsValue.replacementText
    };
  }

  public async invoke(context: ToolHandlerContext, value: JsonValue): Promise<ToolHandlerOutput> {
    const argumentsValue = parseArguments(value);
    const result = await this.tool.execute(context, argumentsValue);
    if (!result.isSuccess) {
      throw new ToolHandlerError(result.errorCode ?? "REPLACEMENT_FAILED", result.message, false);
    }
    return {
      data: {
        message: result.message,
        beforeFileHash: result.beforeFileHash,
        afterFileHash: result.afterFileHash,
        workspaceHash: result.workspaceHash,
        replayedReceipt: result.replayedReceipt
      },
      resultCount: 1,
      truncated: false,
      mutation: {
        beforeFileHash: result.beforeFileHash,
        afterFileHash: result.afterFileHash,
        workspaceHash: result.workspaceHash,
        replayedReceipt: result.replayedReceipt
      }
    };
  }
}

async function readReceipt(path: string): Promise<ReplacementReceipt | null> {
  let content: Buffer;
  try {
    content = await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(decodeUtf8(content)) as unknown;
  if (!isObject(value)) throw new SyntaxError("Receipt must be an object.");
  const expected = [
    "schemaVersion",
    "idempotencyKey",
    "argumentsHash",
    "relativePath",
    "beforeFileHash",
    "afterFileHash",
    "status"
  ];
  if (Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) {
    throw new SyntaxError("Receipt fields are invalid.");
  }
  if (
    value["schemaVersion"] !== "1.0" ||
    typeof value["idempotencyKey"] !== "string" ||
    typeof value["argumentsHash"] !== "string" ||
    typeof value["relativePath"] !== "string" ||
    typeof value["beforeFileHash"] !== "string" ||
    typeof value["afterFileHash"] !== "string" ||
    (value["status"] !== "prepared" && value["status"] !== "completed")
  ) {
    throw new SyntaxError("Receipt values are invalid.");
  }
  return value as unknown as ReplacementReceipt;
}

async function writeReceipt(path: string, receipt: ReplacementReceipt): Promise<void> {
  await writeFileAtomic(
    path,
    `${canonicalizeValue({
      schemaVersion: receipt.schemaVersion,
      idempotencyKey: receipt.idempotencyKey,
      argumentsHash: receipt.argumentsHash,
      relativePath: receipt.relativePath,
      beforeFileHash: receipt.beforeFileHash,
      afterFileHash: receipt.afterFileHash,
      status: receipt.status
    })}\n`
  );
}

function decodeUtf8(value: Uint8Array): string {
  try {
    return STRICT_UTF8.decode(value);
  } catch (error) {
    throw new TypeError("Input is not valid UTF-8.", { cause: error });
  }
}

function countOccurrences(input: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const match = input.indexOf(value, offset);
    if (match < 0) break;
    count++;
    offset = match + value.length;
  }
  return count;
}

function parseArguments(value: unknown): ReplaceTextArguments {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Replacement arguments must be an object.");
  }
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join("|") !== "expectedText|relativePath|replacementText") {
    throw new TypeError("Replacement argument fields are invalid.");
  }
  const relativePath = root["relativePath"];
  const expectedText = root["expectedText"];
  const replacementText = root["replacementText"];
  if (
    typeof relativePath !== "string" ||
    typeof expectedText !== "string" ||
    typeof replacementText !== "string"
  ) {
    throw new TypeError("Replacement arguments must be strings.");
  }
  return { relativePath, expectedText, replacementText };
}

function success(
  receipt: ReplacementReceipt,
  workspaceHash: string,
  replayedReceipt: boolean
): ToolResult {
  return {
    isSuccess: true,
    errorCode: null,
    message: replayedReceipt ? "Replacement receipt reconciled." : "Replacement committed.",
    beforeFileHash: receipt.beforeFileHash,
    afterFileHash: receipt.afterFileHash,
    workspaceHash,
    replayedReceipt
  };
}

function failure(errorCode: string, message: string): ToolResult {
  return {
    isSuccess: false,
    errorCode,
    message,
    beforeFileHash: null,
    afterFileHash: null,
    workspaceHash: "",
    replayedReceipt: false
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
