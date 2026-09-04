import { describe, expect, it } from "vitest";
import {
  createRunEvent,
  EMPTY_HASH,
  type EventPayload,
  type RunEvent
} from "../../src/core/events.js";
import {
  applyRunEvent,
  canTransition,
  emptyProjection,
  type RunProjection,
  replayRun
} from "../../src/core/runs.js";
import { validEventPayload } from "../helpers/event-fixtures.js";

const hash = "a".repeat(64);

function event(
  projection: RunProjection,
  eventType: RunEvent["eventType"],
  payload: EventPayload,
  runId = projection.runId
): RunEvent {
  return {
    schemaVersion: "1.0",
    runId,
    sequence: projection.lastSequence + 1,
    eventType,
    occurredAt: "2026-09-01T00:00:00.0000000+00:00",
    payload: validEventPayload(eventType, payload),
    previousHash: projection.eventChainHead,
    eventHash: hash
  };
}

function created(): RunProjection {
  const empty = emptyProjection("run-1");
  return applyRunEvent(
    empty,
    event(empty, "run.created", { taskId: "task-1", descriptorHash: hash })
  );
}

function transition(projection: RunProjection, to: string): RunProjection {
  return applyRunEvent(
    projection,
    event(projection, "state.transitioned", { from: projection.status, to, reason: "test" })
  );
}

describe("run projection", () => {
  it("defines allowed and terminal transitions", () => {
    expect(canTransition("queued", "preparing")).toBe(true);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("reviewing", "completed")).toBe(true);
    expect(canTransition("completed", "executing")).toBe(false);
  });

  it("rejects empty IDs, wrong run, and noncontiguous events", () => {
    expect(() => emptyProjection("")).toThrow(TypeError);
    const projection = created();
    expect(() =>
      applyRunEvent(projection, event(projection, "instruction.selected", {}, "other"))
    ).toThrow("different run");
    expect(() =>
      applyRunEvent(projection, { ...event(projection, "instruction.selected", {}), sequence: 9 })
    ).toThrow("not contiguous");
  });

  it("applies lifecycle transitions and rejects mismatches", () => {
    const projection = created();
    expect(transition(projection, "preparing").status).toBe("preparing");
    expect(() =>
      applyRunEvent(
        projection,
        event(projection, "state.transitioned", {
          from: "preparing",
          to: "researching",
          reason: "bad"
        })
      )
    ).toThrow("Transition expected");
    expect(() => transition(projection, "completed")).toThrow("is not allowed");
    expect(() => transition(projection, "unknown")).toThrow("state.transitioned contract");
  });

  it("enforces event prerequisites", () => {
    const projection = created();
    expect(() =>
      applyRunEvent(projection, event(projection, "provider.decision_recorded", {}))
    ).toThrow("only while planning");
    expect(() =>
      applyRunEvent(projection, event(projection, "policy.decision_recorded", {}))
    ).toThrow("only while executing");
    expect(() => applyRunEvent(projection, event(projection, "tool.dispatched", {}))).toThrow(
      "only while executing"
    );
    expect(() => applyRunEvent(projection, event(projection, "tool.completed", {}))).toThrow(
      "prior dispatch"
    );
    expect(() => applyRunEvent(projection, event(projection, "verification.recorded", {}))).toThrow(
      "committed mutation"
    );
    expect(() => applyRunEvent(projection, event(projection, "evaluation.recorded", {}))).toThrow(
      "recorded verification"
    );
    expect(() => applyRunEvent(projection, event(projection, "checkpoint.recorded", {}))).toThrow(
      "committed workspace mutation"
    );
  });

  it("counts decisions, dispatches, successful mutations, verification, and evaluation", () => {
    let projection = created();
    projection = transition(projection, "preparing");
    projection = transition(projection, "researching");
    projection = transition(projection, "planning");
    projection = applyRunEvent(
      projection,
      event(projection, "provider.decision_recorded", { actionSignature: hash })
    );
    expect(projection.decisionsUsed).toBe(1);
    projection = transition(projection, "executing");
    projection = applyRunEvent(projection, event(projection, "tool.dispatched", {}));
    expect(projection.toolDispatchesUsed).toBe(1);
    const failed = applyRunEvent(
      projection,
      event(projection, "tool.completed", { outcome: "failed" })
    );
    expect(failed.workspaceMutations).toBe(0);
    projection = applyRunEvent(
      projection,
      event(projection, "tool.completed", { outcome: "succeeded" })
    );
    expect(projection.workspaceMutations).toBe(1);
    projection = transition(projection, "verifying");
    projection = applyRunEvent(projection, event(projection, "verification.recorded", {}));
    expect(projection.verificationRecorded).toBe(true);
    projection = transition(projection, "reviewing");
    projection = applyRunEvent(
      projection,
      event(projection, "evaluation.recorded", { verdict: "approved" })
    );
    expect(projection.reviewVerdict).toBe("approved");
    projection = applyRunEvent(projection, event(projection, "run.completed", {}));
    expect(projection.status).toBe("completed");
    expect(() =>
      applyRunEvent(projection, event(projection, "run.blocked", { reason: "late" }))
    ).toThrow("terminal run");
  });

  it("applies interruption and terminal reasons", () => {
    const projection = created();
    expect(
      applyRunEvent(projection, event(projection, "run.interrupted", { reason: "pause" }))
        .terminalReason
    ).toBe("pause");
    const blocked = applyRunEvent(projection, event(projection, "run.blocked", { reason: "deny" }));
    expect(blocked.status).toBe("blocked");
    expect(blocked.terminalReason).toBe("deny");
  });
});

describe("semantic replay", () => {
  it("requires run creation first and rejects a duplicate singleton", () => {
    const transitionFirst = createRunEvent(
      "run-1",
      1,
      {
        eventType: "state.transitioned",
        occurredAt: "2026-09-01T00:00:00.0000000+00:00",
        payload: validEventPayload("state.transitioned", {
          from: "queued",
          to: "preparing",
          reason: "bad"
        })
      },
      EMPTY_HASH
    );
    expect(() => replayRun("run-1", [transitionFirst])).toThrow("begin with run creation");

    const first = createRunEvent(
      "run-1",
      1,
      {
        eventType: "run.created",
        occurredAt: "2026-09-01T00:00:00.0000000+00:00",
        payload: validEventPayload("run.created")
      },
      EMPTY_HASH
    );
    const duplicate = createRunEvent(
      "run-1",
      2,
      {
        eventType: "run.created",
        occurredAt: "2026-09-01T00:00:01.0000000+00:00",
        payload: validEventPayload("run.created")
      },
      first.eventHash
    );
    expect(() => replayRun("run-1", [first, duplicate])).toThrow("at most once");
  });
});
