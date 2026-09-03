import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RecordedProvider } from "../../src/adapters/provider.js";
import { assembleModelContext } from "../../src/application/context-assembler.js";
import {
  completeValidatedTurn,
  createModelTurnRequest
} from "../../src/application/model-provider.js";
import { emptyProjection } from "../../src/core/runs.js";
import { createTrustEnvelope } from "../../src/core/trust.js";

describe("recorded provider compatibility", () => {
  it("supports atomic completed turns while preserving the legacy decision facade", async () => {
    const [fixture, schema] = await Promise.all([
      readFile(resolve("config/providers/fixture-openai.v1.json")),
      readFile(resolve("schemas/v1/provider-capabilities.schema.json"))
    ]);
    const provider = RecordedProvider.fromFixture(fixture, schema);
    const context = assembleModelContext(
      [
        createTrustEnvelope({
          origin: "distribution_instruction",
          sourceReference: "package:prompt-v2",
          content: "Obey policy.",
          maximumBytes: 1_024
        })
      ],
      { maxParts: 2, maxTotalBytes: 4_096 }
    );
    const request = createModelTurnRequest({
      sessionId: "recorded-session",
      turnNumber: 1,
      messages: context.messages,
      tools: [],
      maxOutputTokens: 100
    });
    const turn = await completeValidatedTurn(provider, request, {
      isCancellationRequested: false
    });
    const decision = await provider.decide({
      taskId: "task-1",
      objective: "replace",
      targetRelativePath: "src/Greeting.txt",
      expectedText: "before",
      replacementText: "after",
      projection: { ...emptyProjection("run-1"), taskId: "task-1", status: "planning" }
    });

    expect(turn.finishReason).toBe("completed");
    expect(turn.providerId).toBe(provider.id);
    expect(turn.usage.costMode).toBe("host_managed");
    expect(decision.toolName).toBe("workspace.replace_exact_text");
  });
});
