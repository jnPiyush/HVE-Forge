import { describe, expect, it } from "vitest";
import type { PolicyDefinition } from "../../src/core/policy.js";
import {
  createToolRegistry,
  type ToolCapabilityClass,
  type ToolDescriptor,
  type ToolRegistryCapabilities,
  ToolRegistryError,
  toolActionClass
} from "../../src/core/tool-registry.js";

const permissivePolicy: PolicyDefinition = {
  version: "1.0.0",
  contentHash: "b".repeat(64),
  defaultEffect: "allow",
  defaultRuleId: "default-allow",
  rules: []
};

const denyByDefaultPolicy: PolicyDefinition = {
  version: "1.0.0",
  contentHash: "c".repeat(64),
  defaultEffect: "deny",
  defaultRuleId: "default-deny",
  rules: [
    { ruleId: "allow-read", effect: "allow", toolName: "*", actionClass: "read" },
    {
      ruleId: "allow-replace",
      effect: "allow",
      toolName: "workspace.replace_exact_text",
      actionClass: "workspace_write"
    }
  ]
};

const closedCapabilities: ToolRegistryCapabilities = {
  isolationBackendRegistered: false,
  egressReceiptsEnabled: false
};

const openCapabilities: ToolRegistryCapabilities = {
  isolationBackendRegistered: true,
  egressReceiptsEnabled: true
};

function descriptor(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    toolId: "workspace.read_file",
    version: "1.0.0",
    capabilityClass: "read",
    bounds: { maxOutputBytes: 65_536, maxResultCount: 200 },
    ...overrides
  };
}

function expectCode(build: () => unknown, code: string): void {
  try {
    build();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolRegistryError);
    expect((error as ToolRegistryError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ToolRegistryError with code ${code}.`);
}

describe("tool registry admission", () => {
  it("maps each capability class to its policy action class", () => {
    expect(toolActionClass("read")).toBe("read");
    expect(toolActionClass("search")).toBe("read");
    expect(toolActionClass("write")).toBe("workspace_write");
    expect(toolActionClass("network")).toBe("external_write");
    expect(toolActionClass("execute")).toBe("privileged");
  });

  it("admits read, search, and write tools under a deny-by-default policy", () => {
    const registry = createToolRegistry(
      [
        descriptor({ toolId: "workspace.search_text", capabilityClass: "search" }),
        descriptor({ toolId: "workspace.read_file" }),
        descriptor({ toolId: "workspace.list_directory" }),
        descriptor({
          toolId: "workspace.replace_exact_text",
          capabilityClass: "write"
        })
      ],
      denyByDefaultPolicy,
      closedCapabilities
    );

    expect(registry.admissions.map((item) => item.descriptor.toolId)).toEqual([
      "workspace.list_directory",
      "workspace.read_file",
      "workspace.replace_exact_text",
      "workspace.search_text"
    ]);
    expect(registry.has("workspace.read_file")).toBe(true);
    expect(registry.get("workspace.search_text").actionClass).toBe("read");
    expect(registry.get("workspace.replace_exact_text").ruleIds).toEqual(["allow-replace"]);
  });

  it("refuses an execute-class tool when no isolation backend is registered", () => {
    expectCode(
      () =>
        createToolRegistry(
          [descriptor({ toolId: "process.execute", capabilityClass: "execute" })],
          permissivePolicy,
          closedCapabilities
        ),
      "isolation_required"
    );
  });

  it("refuses a network-class tool when egress receipts are disabled", () => {
    expectCode(
      () =>
        createToolRegistry(
          [descriptor({ toolId: "net.fetch_url", capabilityClass: "network" })],
          permissivePolicy,
          closedCapabilities
        ),
      "egress_receipts_required"
    );
  });

  it("still refuses high-risk classes that policy denies even when capabilities are present", () => {
    expectCode(
      () =>
        createToolRegistry(
          [descriptor({ toolId: "process.execute", capabilityClass: "execute" })],
          denyByDefaultPolicy,
          openCapabilities
        ),
      "policy_denied"
    );
    expectCode(
      () =>
        createToolRegistry(
          [descriptor({ toolId: "net.fetch_url", capabilityClass: "network" })],
          denyByDefaultPolicy,
          openCapabilities
        ),
      "policy_denied"
    );
  });

  it("aborts the whole build rather than skipping a denied descriptor", () => {
    expectCode(
      () =>
        createToolRegistry(
          [descriptor(), descriptor({ toolId: "process.execute", capabilityClass: "execute" })],
          denyByDefaultPolicy,
          openCapabilities
        ),
      "policy_denied"
    );
  });

  it("rejects malformed descriptors", () => {
    expectCode(
      () =>
        createToolRegistry(
          [descriptor({ toolId: "ReadFile" })],
          permissivePolicy,
          closedCapabilities
        ),
      "invalid_tool_id"
    );
    expectCode(
      () =>
        createToolRegistry(
          [descriptor({ toolId: "readfile" })],
          permissivePolicy,
          closedCapabilities
        ),
      "invalid_tool_id"
    );
    expectCode(
      () =>
        createToolRegistry([descriptor({ version: "1.0" })], permissivePolicy, closedCapabilities),
      "invalid_version"
    );
    expectCode(
      () =>
        createToolRegistry(
          [descriptor({ capabilityClass: "browse" as never })],
          permissivePolicy,
          closedCapabilities
        ),
      "unknown_capability_class"
    );
  });

  it("rejects bounds that are absent, non-integer, zero, or above the ceiling", () => {
    const cases = [
      { maxOutputBytes: 0, maxResultCount: 1 },
      { maxOutputBytes: 1.5, maxResultCount: 1 },
      { maxOutputBytes: 1, maxResultCount: 0 },
      { maxOutputBytes: 4_194_305, maxResultCount: 1 },
      { maxOutputBytes: 1, maxResultCount: 10_001 }
    ];
    for (const bounds of cases) {
      expectCode(
        () => createToolRegistry([descriptor({ bounds })], permissivePolicy, closedCapabilities),
        "invalid_bounds"
      );
    }
    expectCode(
      () =>
        createToolRegistry(
          [descriptor({ bounds: undefined as never })],
          permissivePolicy,
          closedCapabilities
        ),
      "invalid_bounds"
    );
  });

  it("rejects duplicate identifiers", () => {
    expectCode(
      () => createToolRegistry([descriptor(), descriptor()], permissivePolicy, closedCapabilities),
      "duplicate_tool_id"
    );
  });

  it("throws a typed error for an unregistered tool lookup", () => {
    const registry = createToolRegistry([descriptor()], permissivePolicy, closedCapabilities);
    expect(registry.has("workspace.search_text")).toBe(false);
    expectCode(() => registry.get("workspace.search_text"), "unknown_tool");
  });

  it("is immutable after construction", () => {
    const registry = createToolRegistry([descriptor()], permissivePolicy, closedCapabilities);
    expect(registry.admissions).toHaveLength(1);
    const admission = registry.admissions[0];
    if (admission === undefined) throw new Error("Expected one admission.");

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.admissions)).toBe(true);
    expect(Object.isFrozen(admission)).toBe(true);
    expect(Object.isFrozen(admission.ruleIds)).toBe(true);
    expect(Object.isFrozen(admission.descriptor)).toBe(true);
    expect(Object.isFrozen(admission.descriptor.bounds)).toBe(true);

    expect(() => {
      (admission.descriptor as { capabilityClass: string }).capabilityClass = "execute";
    }).toThrow();
    expect(() => {
      (admission.descriptor.bounds as { maxOutputBytes: number }).maxOutputBytes = 1;
    }).toThrow();
    expect(() => {
      (registry.admissions as unknown as ToolDescriptor[]).push(descriptor());
    }).toThrow();
    expect(admission.descriptor.capabilityClass).toBe("read");
  });

  it("keeps execute and network closed when a capability flag is truthy but not boolean", () => {
    for (const truthy of ["false", "0", 1, {}]) {
      expectCode(
        () =>
          createToolRegistry(
            [descriptor({ toolId: "process.execute", capabilityClass: "execute" })],
            permissivePolicy,
            { isolationBackendRegistered: truthy as never, egressReceiptsEnabled: false }
          ),
        "invalid_capabilities"
      );
      expectCode(
        () =>
          createToolRegistry(
            [descriptor({ toolId: "net.fetch_url", capabilityClass: "network" })],
            permissivePolicy,
            { isolationBackendRegistered: false, egressReceiptsEnabled: truthy as never }
          ),
        "invalid_capabilities"
      );
    }
  });

  it("snapshots capability flags before validation and admission", () => {
    let reads = 0;
    const changing = {
      get isolationBackendRegistered(): boolean {
        reads += 1;
        return reads > 1;
      },
      egressReceiptsEnabled: false
    } as ToolRegistryCapabilities;
    expectCode(
      () =>
        createToolRegistry(
          [descriptor({ toolId: "process.execute", capabilityClass: "execute" })],
          permissivePolicy,
          changing
        ),
      "isolation_required"
    );
  });

  it("refuses a descriptor whose capability class changes between reads", () => {
    let reads = 0;
    const shapeShifter = {
      toolId: "workspace.read_file",
      version: "1.0.0",
      bounds: { maxOutputBytes: 1_024, maxResultCount: 10 },
      get capabilityClass(): ToolCapabilityClass {
        reads += 1;
        return reads <= 1 ? "read" : "execute";
      }
    } as ToolDescriptor;

    const registry = createToolRegistry([shapeShifter], permissivePolicy, closedCapabilities);
    expect(registry.admissions[0]?.descriptor.capabilityClass).toBe("read");
    expect(registry.admissions[0]?.actionClass).toBe("read");
  });

  it("honours an explicit deny rule over a matching allow rule", () => {
    const conflicted: PolicyDefinition = {
      version: "1.0.0",
      contentHash: "d".repeat(64),
      defaultEffect: "allow",
      defaultRuleId: "default-allow",
      rules: [
        { ruleId: "allow-read", effect: "allow", toolName: "*", actionClass: "read" },
        {
          ruleId: "deny-quarantined",
          effect: "deny",
          toolName: "workspace.read_file",
          actionClass: null
        }
      ]
    };
    expectCode(
      () => createToolRegistry([descriptor()], conflicted, closedCapabilities),
      "policy_denied"
    );
  });

  it("admits bounds sitting exactly on the ceiling", () => {
    const registry = createToolRegistry(
      [descriptor({ bounds: { maxOutputBytes: 4_194_304, maxResultCount: 10_000 } })],
      permissivePolicy,
      closedCapabilities
    );
    expect(registry.admissions[0]?.descriptor.bounds).toEqual({
      maxOutputBytes: 4_194_304,
      maxResultCount: 10_000
    });
  });

  it("builds an empty frozen registry from an empty descriptor list", () => {
    const registry = createToolRegistry([], denyByDefaultPolicy, closedCapabilities);
    expect(registry.admissions).toEqual([]);
    expect(Object.isFrozen(registry.admissions)).toBe(true);
    expect(registry.has("workspace.read_file")).toBe(false);
  });

  it("rejects malformed containers with typed errors", () => {
    expectCode(
      () => createToolRegistry(undefined as never, permissivePolicy, closedCapabilities),
      "invalid_descriptors"
    );
    expectCode(
      () => createToolRegistry([null as never], permissivePolicy, closedCapabilities),
      "invalid_descriptor"
    );
    expectCode(
      () => createToolRegistry([descriptor()], permissivePolicy, null as never),
      "invalid_capabilities"
    );
    expectCode(
      () =>
        createToolRegistry(
          [descriptor()],
          { ...permissivePolicy, rules: undefined as never },
          closedCapabilities
        ),
      "invalid_policy"
    );
    expectCode(
      () =>
        createToolRegistry(
          [descriptor()],
          { ...permissivePolicy, rules: [null as never] },
          closedCapabilities
        ),
      "invalid_policy"
    );
  });

  it("produces a stable order regardless of input order", () => {
    const forward = createToolRegistry(
      [
        descriptor({ toolId: "workspace.read_file" }),
        descriptor({ toolId: "workspace.list_directory" })
      ],
      permissivePolicy,
      closedCapabilities
    );
    const reversed = createToolRegistry(
      [
        descriptor({ toolId: "workspace.list_directory" }),
        descriptor({ toolId: "workspace.read_file" })
      ],
      permissivePolicy,
      closedCapabilities
    );
    expect(forward.admissions.map((item) => item.descriptor.toolId)).toEqual(
      reversed.admissions.map((item) => item.descriptor.toolId)
    );
  });
});
