import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  McpCursorCodec,
  McpRequestStateProtector,
  McpStateIntegrityError,
  validateMcpRequest,
  validateMcpResponse
} from "../../src/adapters/mcp.js";

const metadata = {
  protocolVersion: "2026-07-28",
  capabilities: {}
};

describe("MCP validation", () => {
  it("accepts a negotiated core request", () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      _meta: metadata
    });
    expect(validateMcpRequest(request)).toEqual({ valid: true, errorCode: null, message: null });
  });

  it.each([
    ["roots/list", "DEPRECATED_METHOD"],
    ["tasks/get", "UNSUPPORTED_METHOD"],
    ["unknown/method", "UNSUPPORTED_METHOD"]
  ])("rejects method %s", (method, errorCode) => {
    const result = validateMcpRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, _meta: metadata })
    );
    expect(result.errorCode).toBe(errorCode);
  });

  it("requires both host and request task negotiation", () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/get",
      _meta: { ...metadata, capabilities: { tasks: true } }
    });
    expect(validateMcpRequest(request, { tasksEnabled: true }).valid).toBe(true);
    expect(validateMcpRequest(request).valid).toBe(false);
  });

  it("rejects remote references and invalid responses", () => {
    expect(
      validateMcpRequest(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          _meta: metadata,
          params: { schema: { $ref: "https://example.invalid" } }
        })
      ).errorCode
    ).toBe("REMOTE_REF_DISABLED");
    expect(validateMcpResponse('{"jsonrpc":"2.0","result":{}}').errorCode).toBe(
      "MISSING_RESULT_TYPE"
    );
  });

  it.each([
    ["", "REQUEST_SIZE"],
    ["{", "MALFORMED_JSON"],
    [JSON.stringify({ jsonrpc: "1.0", method: "tools/list", _meta: metadata }), "INVALID_ENVELOPE"],
    [JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }), "MISSING_REQUEST_META"],
    [
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tasks/get",
        _meta: { ...metadata, capabilities: {} }
      }),
      "UNSUPPORTED_METHOD"
    ],
    [
      JSON.stringify({
        jsonrpc: "2.0",
        method: "inputResponses/submit",
        _meta: metadata,
        params: { requestState: "state" }
      }),
      "INVALID_INPUT_RESPONSE"
    ]
  ])("returns %s request error", (request, errorCode) => {
    expect(validateMcpRequest(request).errorCode).toBe(errorCode);
  });

  it("rejects task requests missing request capability after host negotiation", () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      method: "tasks/get",
      _meta: { ...metadata, capabilities: {} }
    });
    expect(validateMcpRequest(request, { tasksEnabled: true }).errorCode).toBe(
      "CAPABILITY_NOT_NEGOTIATED"
    );
  });

  it("accepts valid input responses", () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      method: "inputResponses/submit",
      _meta: metadata,
      params: { requestState: "state", inputResponses: [] }
    });
    expect(validateMcpRequest(request).valid).toBe(true);
  });

  it.each([
    ["", "RESPONSE_SIZE"],
    ["{", "MALFORMED_JSON"],
    [JSON.stringify({ jsonrpc: "1.0", result: { resultType: "x" } }), "INVALID_ENVELOPE"],
    [JSON.stringify({ jsonrpc: "2.0" }), "INVALID_RESPONSE"],
    [
      JSON.stringify({ jsonrpc: "2.0", result: { resultType: "x" }, error: {} }),
      "INVALID_RESPONSE"
    ],
    [JSON.stringify({ jsonrpc: "2.0", result: null }), "MISSING_RESULT_TYPE"],
    [JSON.stringify({ jsonrpc: "2.0", error: { code: "x", message: 1 } }), "INVALID_ERROR"]
  ])("returns %s response error", (response, errorCode) => {
    expect(validateMcpResponse(response).errorCode).toBe(errorCode);
  });

  it("accepts typed result and structured error responses", () => {
    expect(
      validateMcpResponse(JSON.stringify({ jsonrpc: "2.0", result: { resultType: "tools" } })).valid
    ).toBe(true);
    expect(
      validateMcpResponse(JSON.stringify({ jsonrpc: "2.0", error: { code: -1, message: "bad" } }))
        .valid
    ).toBe(true);
  });
});

describe("MCP request state", () => {
  it("protects state and binds cursor scope and expiry", () => {
    const protector = new McpRequestStateProtector(randomBytes(32));
    const codec = new McpCursorCodec(protector);
    const token = codec.encode({
      value: "next",
      expiresAtUnixMilliseconds: 2_000,
      cacheScope: "a"
    });
    expect(codec.decode(token, "a", new Date(1_000))).toEqual({
      value: "next",
      expiresAtUnixMilliseconds: 2_000,
      cacheScope: "a"
    });
    expect(() => codec.decode(token, "b", new Date(1_000))).toThrow(McpStateIntegrityError);
    expect(() => codec.decode(token, "a", new Date(2_000))).toThrow(McpStateIntegrityError);
  });

  it("rejects token tampering", () => {
    const protector = new McpRequestStateProtector(randomBytes(32));
    const token = protector.protect({ value: "safe" });
    const changed = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(() => protector.unprotect(changed)).toThrow(McpStateIntegrityError);
  });

  it("rejects non-canonical base64url token encodings", () => {
    const protector = new McpRequestStateProtector(randomBytes(32));
    const token = protector.protect({ value: "safe" });
    const [payload, signature] = token.split(".");
    expect(() => protector.unprotect(`${payload}*.${signature}`)).toThrow(McpStateIntegrityError);
  });

  it("rejects weak keys, malformed tokens, oversized state, and malformed cursors", () => {
    expect(() => new McpRequestStateProtector(randomBytes(31))).toThrow(RangeError);
    const protector = new McpRequestStateProtector(randomBytes(32));
    expect(() => protector.protect({ value: "x".repeat(70_000) })).toThrow(RangeError);
    expect(() => protector.unprotect("one-part")).toThrow(McpStateIntegrityError);
    const codec = new McpCursorCodec(protector);
    expect(() =>
      codec.encode({ value: "", expiresAtUnixMilliseconds: 1, cacheScope: "scope" })
    ).toThrow(TypeError);
    const nonCursor = protector.protect({ value: "x" });
    expect(() => codec.decode(nonCursor, "scope", new Date(0))).toThrow(McpStateIntegrityError);
  });
});
