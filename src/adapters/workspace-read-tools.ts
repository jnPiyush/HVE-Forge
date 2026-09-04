import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  ToolHandler,
  ToolHandlerContext,
  ToolHandlerOutput
} from "../application/tool-dispatcher.js";
import { ToolHandlerError } from "../application/tool-dispatcher.js";
import { canonicalizeValue, type JsonValue, sha256Hex } from "../core/canonical-json.js";
import type { ToolDescriptor } from "../core/tool-registry.js";
import {
  assertNoLinks,
  PathSafetyError,
  readConfinedRegularFile,
  validateRelativePath
} from "./path-safety.js";

const MAXIMUM_SOURCE_BYTES = 1_048_576;
const MAXIMUM_SEARCH_FILES = 2_000;
const MAXIMUM_SEARCH_BYTES = 16_777_216;
const MAXIMUM_PREVIEW_CHARACTERS = 512;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });
const PROTECTED_SEGMENTS = new Set([
  ".git",
  ".hve",
  ".hve-control",
  "node_modules",
  "dist",
  "coverage",
  "artifacts"
]);
const PROTECTED_FILES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials",
  "id_rsa",
  "id_ed25519"
]);

export const FILE_READ_DESCRIPTOR: ToolDescriptor = Object.freeze({
  toolId: "workspace.read_file",
  version: "1.0.0",
  capabilityClass: "read",
  bounds: Object.freeze({ maxOutputBytes: 65_536, maxResultCount: 1 })
});

export const DIRECTORY_LIST_DESCRIPTOR: ToolDescriptor = Object.freeze({
  toolId: "workspace.list_directory",
  version: "1.0.0",
  capabilityClass: "read",
  bounds: Object.freeze({ maxOutputBytes: 65_536, maxResultCount: 500 })
});

export const TEXT_SEARCH_DESCRIPTOR: ToolDescriptor = Object.freeze({
  toolId: "workspace.search_text",
  version: "1.0.0",
  capabilityClass: "search",
  bounds: Object.freeze({ maxOutputBytes: 65_536, maxResultCount: 200 })
});

export class FileReadHandler implements ToolHandler {
  public readonly descriptor = FILE_READ_DESCRIPTOR;

  public parseInput(value: unknown): JsonValue {
    return { relativePath: parseRelativePath(value, false) };
  }

  public async invoke(context: ToolHandlerContext, value: JsonValue): Promise<ToolHandlerOutput> {
    const relativePath = readString(value, "relativePath");
    assertReadablePath(relativePath, false);
    try {
      const bytes = await readConfinedRegularFile(
        context.workspaceRoot,
        relativePath,
        MAXIMUM_SOURCE_BYTES
      );
      decodeUtf8(bytes);
      const fitted = fitReadData(relativePath, bytes, this.descriptor.bounds.maxOutputBytes);
      return {
        data: fitted.data,
        resultCount: 1,
        truncated: fitted.truncated,
        mutation: null
      };
    } catch (error) {
      throw mapReadError(error);
    }
  }
}

export class DirectoryListHandler implements ToolHandler {
  public readonly descriptor = DIRECTORY_LIST_DESCRIPTOR;

  public parseInput(value: unknown): JsonValue {
    return { relativePath: parseRelativePath(value, true) };
  }

  public async invoke(context: ToolHandlerContext, value: JsonValue): Promise<ToolHandlerOutput> {
    const relativePath = readString(value, "relativePath");
    assertReadablePath(relativePath, true);
    try {
      const directory = await resolveDirectory(context.workspaceRoot, relativePath);
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((left, right) => compareCodeUnits(left.name, right.name));
      const entries: JsonValue[] = [];
      let omittedEntries = 0;
      for (const child of children) {
        if (context.cancellation.isCancellationRequested !== false) {
          throw new ToolHandlerError("CANCELLED", "Directory listing was cancelled.", false);
        }
        if (isProtectedName(child.name) || child.isSymbolicLink()) {
          omittedEntries += 1;
          continue;
        }
        const path = resolve(directory, child.name);
        await assertNoLinks(context.workspaceRoot, path);
        const metadata = await lstat(path);
        if (!metadata.isFile() && !metadata.isDirectory()) {
          omittedEntries += 1;
          continue;
        }
        const entry: JsonValue = {
          name: child.name,
          kind: metadata.isDirectory() ? "directory" : "file",
          size: metadata.isFile() ? metadata.size : 0
        };
        if (entries.length >= this.descriptor.bounds.maxResultCount) {
          omittedEntries += 1;
          continue;
        }
        entries.push(entry);
        const candidate = directoryData(relativePath, entries, omittedEntries);
        if (serializedBytes(candidate) > this.descriptor.bounds.maxOutputBytes) {
          entries.pop();
          omittedEntries += 1;
        }
      }
      return {
        data: directoryData(relativePath, entries, omittedEntries),
        resultCount: entries.length,
        truncated: omittedEntries > 0,
        mutation: null
      };
    } catch (error) {
      throw mapReadError(error);
    }
  }
}

export class TextSearchHandler implements ToolHandler {
  public readonly descriptor = TEXT_SEARCH_DESCRIPTOR;

  public parseInput(value: unknown): JsonValue {
    const root = parseExactObject(value, ["query"]);
    const query = root["query"];
    if (
      typeof query !== "string" ||
      query.length < 1 ||
      query.length > 256 ||
      [...query].some((character) => character.charCodeAt(0) < 0x20)
    ) {
      throw new TypeError("query must contain 1 to 256 non-control characters.");
    }
    return { query };
  }

  public async invoke(context: ToolHandlerContext, value: JsonValue): Promise<ToolHandlerOutput> {
    const query = readString(value, "query");
    try {
      const scan = await searchWorkspace(context, query, this.descriptor.bounds.maxResultCount);
      while (
        scan.matches.length > 0 &&
        serializedBytes(searchData(query, scan)) > this.descriptor.bounds.maxOutputBytes
      ) {
        scan.matches.pop();
        scan.truncated = true;
      }
      return {
        data: searchData(query, scan),
        resultCount: scan.matches.length,
        truncated: scan.truncated,
        mutation: null
      };
    } catch (error) {
      throw mapReadError(error);
    }
  }
}

interface SearchState {
  readonly matches: JsonValue[];
  filesScanned: number;
  bytesScanned: number;
  skippedFiles: number;
  truncated: boolean;
}

async function searchWorkspace(
  context: ToolHandlerContext,
  query: string,
  maximumMatches: number
): Promise<SearchState> {
  const state: SearchState = {
    matches: [],
    filesScanned: 0,
    bytesScanned: 0,
    skippedFiles: 0,
    truncated: false
  };
  const root = resolve(context.workspaceRoot);
  await assertNoLinks(root, root);
  await visitDirectory(root, root, context, query, maximumMatches, state);
  return state;
}

async function visitDirectory(
  root: string,
  directory: string,
  context: ToolHandlerContext,
  query: string,
  maximumMatches: number,
  state: SearchState
): Promise<boolean> {
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => compareCodeUnits(left.name, right.name));
  for (const child of children) {
    if (context.cancellation.isCancellationRequested !== false) {
      throw new ToolHandlerError("CANCELLED", "Text search was cancelled.", false);
    }
    if (isProtectedName(child.name) || child.isSymbolicLink()) {
      state.skippedFiles += 1;
      continue;
    }
    const path = resolve(directory, child.name);
    await assertNoLinks(root, path);
    if (child.isDirectory()) {
      if (await visitDirectory(root, path, context, query, maximumMatches, state)) return true;
      continue;
    }
    if (!child.isFile()) {
      state.skippedFiles += 1;
      continue;
    }
    const metadata = await lstat(path);
    if (
      metadata.size > MAXIMUM_SOURCE_BYTES ||
      state.filesScanned >= MAXIMUM_SEARCH_FILES ||
      state.bytesScanned + metadata.size > MAXIMUM_SEARCH_BYTES
    ) {
      state.skippedFiles += 1;
      state.truncated = true;
      continue;
    }
    const bytes = await readFile(path);
    state.filesScanned += 1;
    state.bytesScanned += bytes.byteLength;
    let content: string;
    try {
      content = decodeUtf8(bytes);
    } catch {
      state.skippedFiles += 1;
      continue;
    }
    const relativePath = relative(root, path).split(sep).join("/");
    const lines = content.split(/\r\n|\n|\r/u);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] as string;
      let offset = 0;
      while (offset <= line.length) {
        const column = line.indexOf(query, offset);
        if (column < 0) break;
        state.matches.push({
          relativePath,
          line: lineIndex + 1,
          column: column + 1,
          preview: line.slice(0, MAXIMUM_PREVIEW_CHARACTERS)
        });
        if (state.matches.length >= maximumMatches) {
          state.truncated = true;
          return true;
        }
        offset = column + Math.max(1, query.length);
      }
    }
  }
  return false;
}

function fitReadData(
  relativePath: string,
  bytes: Buffer,
  maximumOutputBytes: number
): { readonly data: JsonValue; readonly truncated: boolean } {
  let low = 0;
  let high = Math.min(bytes.byteLength, maximumOutputBytes);
  let best: Uint8Array = bytes.subarray(0, 0);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const included = validUtf8Prefix(bytes, middle);
    const candidate = readData(relativePath, bytes, included);
    if (serializedBytes(candidate) <= maximumOutputBytes) {
      best = included;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return {
    data: readData(relativePath, bytes, best),
    truncated: best.byteLength < bytes.byteLength
  };
}

function readData(relativePath: string, full: Buffer, included: Uint8Array): JsonValue {
  return {
    relativePath,
    contentHash: sha256Hex(full),
    includedHash: sha256Hex(included),
    byteLength: full.byteLength,
    includedByteLength: included.byteLength,
    truncated: included.byteLength < full.byteLength,
    content: decodeUtf8(included)
  };
}

function directoryData(
  relativePath: string,
  entries: readonly JsonValue[],
  omittedEntries: number
): JsonValue {
  return { relativePath, entries: [...entries], omittedEntries };
}

function searchData(query: string, state: SearchState): JsonValue {
  return {
    query,
    matches: [...state.matches],
    filesScanned: state.filesScanned,
    bytesScanned: state.bytesScanned,
    skippedFiles: state.skippedFiles,
    truncated: state.truncated
  };
}

function parseRelativePath(value: unknown, allowRoot: boolean): string {
  const root = parseExactObject(value, ["relativePath"]);
  const relativePath = root["relativePath"];
  if (typeof relativePath !== "string") throw new TypeError("relativePath must be a string.");
  assertReadablePath(relativePath, allowRoot);
  return relativePath;
}

function parseExactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Tool arguments must be an object.");
  }
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join("|") !== [...fields].sort().join("|")) {
    throw new TypeError("Tool argument fields are invalid.");
  }
  return root;
}

function readString(value: JsonValue, name: string): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Normalized tool arguments must be an object.");
  }
  const result = (value as { readonly [key: string]: JsonValue })[name];
  if (typeof result !== "string") throw new TypeError(`${name} must be a string.`);
  return result;
}

function assertReadablePath(relativePath: string, allowRoot: boolean): void {
  if (allowRoot && relativePath === ".") return;
  validateRelativePath(relativePath);
  const segments = relativePath.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => isProtectedName(segment))) {
    throw new ToolHandlerError("SENSITIVE_PATH", "Requested path is protected.", false);
  }
}

function isProtectedName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    PROTECTED_SEGMENTS.has(lower) ||
    PROTECTED_FILES.has(lower) ||
    /(?:^|[._-])(?:secret|credential|token)(?:[._-]|$)/u.test(lower) ||
    /\.(?:key|pem|p12|pfx)$/u.test(lower)
  );
}

async function resolveDirectory(workspaceRoot: string, relativePath: string): Promise<string> {
  const root = resolve(workspaceRoot);
  const candidate = relativePath === "." ? root : resolve(root, ...relativePath.split(/[\\/]/u));
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new PathSafetyError("OutsideWorkspace", "Path escapes the workspace boundary.");
  }
  await assertNoLinks(root, candidate);
  const metadata = await lstat(candidate);
  if (!metadata.isDirectory()) {
    throw new PathSafetyError("NotRegularFile", "Target must be a directory.");
  }
  return candidate;
}

function validUtf8Prefix(bytes: Uint8Array, maximumBytes: number): Uint8Array {
  let end = Math.min(bytes.byteLength, maximumBytes);
  while (end > 0) {
    const candidate = bytes.subarray(0, end);
    try {
      STRICT_UTF8.decode(candidate);
      return candidate;
    } catch {
      end -= 1;
    }
  }
  return bytes.subarray(0, 0);
}

function decodeUtf8(value: Uint8Array): string {
  try {
    return STRICT_UTF8.decode(value);
  } catch (error) {
    throw new TypeError("Input is not valid UTF-8.", { cause: error });
  }
}

function serializedBytes(value: JsonValue): number {
  return Buffer.byteLength(canonicalizeValue(value), "utf8");
}

function mapReadError(error: unknown): ToolHandlerError {
  if (error instanceof ToolHandlerError) return error;
  if (error instanceof PathSafetyError) {
    return new ToolHandlerError(`PATH_${error.code.toUpperCase()}`, error.message, false, {
      cause: error
    });
  }
  if (error instanceof TypeError && error.message.includes("UTF-8")) {
    return new ToolHandlerError("INVALID_UTF8", "File is not valid UTF-8.", false, {
      cause: error
    });
  }
  if (isNodeError(error)) {
    return new ToolHandlerError("IO_ERROR", "Workspace read failed.", false, { cause: error });
  }
  return new ToolHandlerError("READ_FAILED", "Workspace read failed.", false, {
    cause: error instanceof Error ? error : undefined
  });
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
