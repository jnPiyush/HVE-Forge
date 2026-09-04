import { describe, expect, it } from "vitest";
import {
  createSessionEvent,
  EMPTY_HASH,
  type SessionEvent
} from "../../src/core/session-events.js";
import {
  applySessionEvent,
  countConsecutiveTurnSignature,
  emptySessionProjection,
  replaySession,
  type SessionProjection,
  sessionProjectionHash
} from "../../src/core/sessions.js";
import { validSessionEventPayload } from "../helpers/session-event-fixtures.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function event(
  projection: SessionProjection,
  eventType: SessionEvent["eventType"],
  payload: Record<string, unknown> = {},
  sessionId = projection.sessionId
): SessionEvent {
  return createSessionEvent(
    sessionId,
    projection.lastSequence + 1,
    {
      eventType,
      occurredAt: "2026-09-03T00:00:00.0000000+00:00",
      payload: validSessionEventPayload(eventType as never, payload as never)
    },
    projection.eventChainHead
  );
}

function created(overrides: Record<string, unknown> = {}): SessionProjection {
  const empty = emptySessionProjection("session-1");
  return applySessionEvent(empty, event(empty, "session.created", overrides));
}

describe("session projection", () => {
  it("rejects empty IDs, mismatched sessions, and non-contiguous sequence", () => {
    expect(() => emptySessionProjection("")).toThrow(TypeError);
    const projection = created();
    expect(() =>
      applySessionEvent(projection, event(projection, "turn.requested", { turnNumber: 1 }, "other"))
    ).toThrow("different session");
    expect(() =>
      applySessionEvent(projection, {
        ...event(projection, "turn.requested", { turnNumber: 1 }),
        sequence: 9
      })
    ).toThrow("not contiguous");
  });

  it("tracks a full turn -> tool-call -> verification -> evaluation -> completion cycle", () => {
    let projection = created();
    expect(projection.status).toBe("running");

    projection = applySessionEvent(
      projection,
      event(projection, "turn.requested", { turnNumber: 1, requestHash: HASH_A })
    );
    projection = applySessionEvent(
      projection,
      event(projection, "turn.completed", {
        turnNumber: 1,
        requestHash: HASH_A,
        toolCallCount: 1,
        finishReason: "tool_calls"
      })
    );
    expect(projection.turnsUsed).toBe(1);
    expect(projection.currentTurnToolCallTarget).toBe(1);

    projection = applySessionEvent(
      projection,
      event(projection, "tool.call_dispatched", { turnNumber: 1, callIndex: 0 })
    );
    expect(projection.toolDispatchesUsed).toBe(1);
    projection = applySessionEvent(
      projection,
      event(projection, "tool.call_completed", {
        turnNumber: 1,
        callIndex: 0,
        afterFileHash: HASH_A,
        workspaceHashAfter: HASH_A
      })
    );
    expect(projection.workspaceMutations).toBe(1);
    expect(projection.currentTurnCallsCompleted).toBe(1);
    expect(projection.fingerprintHistory).toEqual([HASH_A]);

    projection = applySessionEvent(
      projection,
      event(projection, "verification.recorded", { turnNumber: 1, attemptNumber: 1 })
    );
    expect(projection.verificationRecorded).toBe(true);
    expect(projection.consecutiveFailedFixes).toBe(0);

    projection = applySessionEvent(
      projection,
      event(projection, "turn.requested", { turnNumber: 2, requestHash: HASH_B })
    );
    projection = applySessionEvent(
      projection,
      event(projection, "turn.completed", {
        turnNumber: 2,
        requestHash: HASH_B,
        toolCallCount: 0,
        finishReason: "completed"
      })
    );
    expect(projection.lastFinishReason).toBe("completed");

    projection = applySessionEvent(
      projection,
      event(projection, "loop.stopped", {
        reason: "provider_completed",
        turnsUsed: 2,
        toolDispatchesUsed: 1
      })
    );
    expect(projection.status).toBe("evaluating");
    expect(projection.stopReason).toBe("provider_completed");

    projection = applySessionEvent(
      projection,
      event(projection, "evaluation.recorded", {
        verdict: "approved",
        eventChainHead: projection.eventChainHead,
        evidenceHashes: [HASH_A]
      })
    );
    expect(projection.reviewVerdict).toBe("approved");

    projection = applySessionEvent(
      projection,
      event(projection, "session.completed", {
        evaluationEventHash: projection.lastEvaluationEventHash
      })
    );
    expect(projection.status).toBe("completed");
    expect(() =>
      applySessionEvent(projection, event(projection, "session.blocked", { reason: "late" }))
    ).toThrow("terminal session");
  });

  it("enforces turn and tool-call ordering prerequisites", () => {
    const projection = created();
    expect(() =>
      applySessionEvent(projection, event(projection, "turn.requested", { turnNumber: 2 }))
    ).toThrow("next sequential turn");
    expect(() =>
      applySessionEvent(
        projection,
        event(projection, "tool.call_dispatched", { turnNumber: 1, callIndex: 0 })
      )
    ).toThrow("out of sequence");
    expect(() =>
      applySessionEvent(projection, event(projection, "verification.recorded", {}))
    ).toThrow("at least one completed turn");
    expect(() =>
      applySessionEvent(projection, event(projection, "evaluation.recorded", {}))
    ).toThrow("recorded verification while evaluating");
  });

  it("rejects a loop.stopped reason that is not yet true", () => {
    let projection = created();
    projection = applySessionEvent(
      projection,
      event(projection, "turn.requested", { turnNumber: 1, requestHash: HASH_A })
    );
    projection = applySessionEvent(
      projection,
      event(projection, "turn.completed", {
        turnNumber: 1,
        requestHash: HASH_A,
        toolCallCount: 0,
        finishReason: "length"
      })
    );
    expect(() =>
      applySessionEvent(
        projection,
        event(projection, "loop.stopped", {
          reason: "provider_completed",
          turnsUsed: 1,
          toolDispatchesUsed: 0
        })
      )
    ).toThrow("provider_completed requires a completed final turn");
    expect(() =>
      applySessionEvent(
        projection,
        event(projection, "loop.stopped", {
          reason: "decision_budget_exhausted",
          turnsUsed: 1,
          toolDispatchesUsed: 0
        })
      )
    ).toThrow("decision_budget_exhausted is not yet true");
    expect(() =>
      applySessionEvent(
        projection,
        event(projection, "loop.stopped", {
          reason: "oscillation_detected",
          turnsUsed: 1,
          toolDispatchesUsed: 0
        })
      )
    ).toThrow("oscillation_detected requires a repeated fingerprint");
  });

  it("blocks after three consecutive failed verification attempts", () => {
    let projection = created({
      limits: {
        maxTurns: 8,
        maxToolDispatches: 16,
        maxElapsedMilliseconds: 300_000,
        maxOutputTokensPerTurn: 16_000,
        maxTotalOutputTokens: 64_000,
        maxTotalCostMinorUnits: 0,
        repeatedSignatureThreshold: 2,
        oscillationWindow: 6,
        maxConsecutiveFailedFixes: 2
      }
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      projection = applySessionEvent(
        projection,
        event(projection, "turn.requested", { turnNumber: attempt, requestHash: HASH_A })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "turn.completed", {
          turnNumber: attempt,
          requestHash: HASH_A,
          toolCallCount: 1,
          finishReason: "tool_calls"
        })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "tool.call_dispatched", { turnNumber: attempt, callIndex: 0 })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "tool.call_completed", {
          turnNumber: attempt,
          callIndex: 0,
          afterFileHash: attempt === 1 ? HASH_A : HASH_B,
          workspaceHashAfter: attempt === 1 ? HASH_A : HASH_B
        })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "verification.recorded", {
          turnNumber: attempt,
          attemptNumber: attempt,
          passedChecks: 0,
          discoveredChecks: 1
        })
      );
    }
    expect(projection.consecutiveFailedFixes).toBe(2);
    projection = applySessionEvent(
      projection,
      event(projection, "loop.stopped", {
        reason: "failed_fix_exhausted",
        turnsUsed: 2,
        toolDispatchesUsed: 2
      })
    );
    expect(projection.status).toBe("running");
    expect(projection.stopReason).toBe("failed_fix_exhausted");
    projection = applySessionEvent(
      projection,
      event(projection, "session.blocked", { reason: "InvestigationRequired" })
    );
    expect(projection.status).toBe("blocked");
  });

  it("computes a stable projection hash independent of limits and fingerprint history", () => {
    const projection = created();
    expect(sessionProjectionHash(projection)).toBe(sessionProjectionHash(projection));
  });

  describe("independent-review regressions", () => {
    it("completes a session whose final turn made zero tool calls and zero mutations", () => {
      let projection = created();
      projection = applySessionEvent(
        projection,
        event(projection, "turn.requested", { turnNumber: 1, requestHash: HASH_A })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "turn.completed", {
          turnNumber: 1,
          requestHash: HASH_A,
          toolCallCount: 0,
          finishReason: "completed"
        })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "loop.stopped", {
          reason: "provider_completed",
          turnsUsed: 1,
          toolDispatchesUsed: 0
        })
      );
      expect(projection.status).toBe("evaluating");
      // Verification used to require `workspaceMutations >= 1`, so a model that correctly
      // decides "no changes needed" could never be verified without crashing the reducer.
      projection = applySessionEvent(
        projection,
        event(projection, "verification.recorded", { turnNumber: 1, attemptNumber: 1 })
      );
      expect(projection.workspaceMutations).toBe(0);
      projection = applySessionEvent(
        projection,
        event(projection, "evaluation.recorded", {
          verdict: "approved",
          eventChainHead: projection.eventChainHead,
          evidenceHashes: [HASH_A]
        })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "session.completed", {
          evaluationEventHash: projection.lastEvaluationEventHash
        })
      );
      expect(projection.status).toBe("completed");
    });

    it("accepts decision_budget_exhausted when only the tool-dispatch budget is exceeded", () => {
      let projection = created({
        limits: {
          maxTurns: 8,
          maxToolDispatches: 1,
          maxElapsedMilliseconds: 300_000,
          maxOutputTokensPerTurn: 16_000,
          maxTotalOutputTokens: 64_000,
          maxTotalCostMinorUnits: 0,
          repeatedSignatureThreshold: 2,
          oscillationWindow: 6,
          maxConsecutiveFailedFixes: 3
        }
      });
      projection = applySessionEvent(
        projection,
        event(projection, "turn.requested", { turnNumber: 1, requestHash: HASH_A })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "turn.completed", {
          turnNumber: 1,
          requestHash: HASH_A,
          toolCallCount: 1,
          finishReason: "tool_calls"
        })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "tool.call_dispatched", { turnNumber: 1, callIndex: 0 })
      );
      // Only the tool-dispatch budget is exhausted (1 >= maxToolDispatches 1); the turn budget
      // is nowhere near exhausted (1 turn used, of 8 allowed). The reducer used to recognize
      // only `turnsUsed >= maxTurns`, so `AgentLoop` crashed with `SessionProjectionError` the
      // moment it legitimately stopped for tool-dispatch exhaustion instead of turn exhaustion.
      expect(projection.toolDispatchesUsed).toBe(1);
      expect(projection.turnsUsed).toBe(1);
      projection = applySessionEvent(
        projection,
        event(projection, "loop.stopped", {
          reason: "decision_budget_exhausted",
          turnsUsed: 1,
          toolDispatchesUsed: 1
        })
      );
      expect(projection.stopReason).toBe("decision_budget_exhausted");
    });

    it("rejects a forged wall_clock_exhausted claim with zero elapsed time", () => {
      const projection = created();
      expect(() =>
        applySessionEvent(
          projection,
          event(projection, "loop.stopped", {
            reason: "wall_clock_exhausted",
            turnsUsed: 0,
            toolDispatchesUsed: 0
          })
        )
      ).toThrow("wall_clock_exhausted is not yet true");
    });

    it("accepts a genuine wall_clock_exhausted claim once enough time has elapsed", () => {
      const projection = created();
      const laterEvent = createSessionEvent(
        projection.sessionId,
        projection.lastSequence + 1,
        {
          eventType: "loop.stopped",
          // The fixture's session.created occurredAt is 2026-09-03T00:00:00Z and its limits
          // cap maxElapsedMilliseconds at 300_000 (5 minutes); this is exactly at the boundary.
          occurredAt: "2026-09-03T00:05:00.0000000+00:00",
          payload: validSessionEventPayload("loop.stopped", {
            reason: "wall_clock_exhausted",
            turnsUsed: 0,
            toolDispatchesUsed: 0
          })
        },
        projection.eventChainHead
      );
      const next = applySessionEvent(projection, laterEvent);
      expect(next.stopReason).toBe("wall_clock_exhausted");
    });

    it("rejects a forged evaluation event-chain/evidence binding via live event application", () => {
      let projection = created();
      projection = applySessionEvent(
        projection,
        event(projection, "turn.requested", { turnNumber: 1, requestHash: HASH_A })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "turn.completed", {
          turnNumber: 1,
          requestHash: HASH_A,
          toolCallCount: 0,
          finishReason: "completed"
        })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "loop.stopped", {
          reason: "provider_completed",
          turnsUsed: 1,
          toolDispatchesUsed: 0
        })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "verification.recorded", { turnNumber: 1, attemptNumber: 1 })
      );
      // A forged eventChainHead/evidenceHashes pair that does not match the real projection
      // state. Previously only `replaySession`'s own duplicate local-variable checks caught
      // this; a single event applied directly through `applySessionEvent` was accepted.
      expect(() =>
        applySessionEvent(
          projection,
          event(projection, "evaluation.recorded", {
            verdict: "approved",
            eventChainHead: HASH_B,
            evidenceHashes: [HASH_B]
          })
        )
      ).toThrow("Evaluation must bind the exact pre-evaluation event head");
    });

    it("rejects a forged session.completed hash binding via live event application", () => {
      let projection = created();
      projection = applySessionEvent(
        projection,
        event(projection, "turn.requested", { turnNumber: 1, requestHash: HASH_A })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "turn.completed", {
          turnNumber: 1,
          requestHash: HASH_A,
          toolCallCount: 0,
          finishReason: "completed"
        })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "loop.stopped", {
          reason: "provider_completed",
          turnsUsed: 1,
          toolDispatchesUsed: 0
        })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "verification.recorded", { turnNumber: 1, attemptNumber: 1 })
      );
      projection = applySessionEvent(
        projection,
        event(projection, "evaluation.recorded", {
          verdict: "approved",
          eventChainHead: projection.eventChainHead,
          evidenceHashes: [HASH_A]
        })
      );
      // A forged verificationResultHash that does not match what was actually verified.
      expect(() =>
        applySessionEvent(
          projection,
          event(projection, "session.completed", {
            evaluationEventHash: projection.lastEvaluationEventHash,
            verificationResultHash: HASH_B
          })
        )
      ).toThrow("Completion must bind the exact approved evaluation and verification result");
    });
  });
});

describe("semantic replay", () => {
  it("requires session creation first", () => {
    const empty = emptySessionProjection("session-1");
    const turn = event(empty, "turn.requested", { turnNumber: 1 });
    expect(() => replaySession("session-1", [turn])).toThrow("begin with creation");
  });

  it("replays a complete session deterministically", () => {
    const first = createSessionEvent(
      "session-1",
      1,
      {
        eventType: "session.created",
        occurredAt: "2026-09-03T00:00:00.0000000+00:00",
        payload: validSessionEventPayload("session.created")
      },
      EMPTY_HASH
    );
    const projection = replaySession("session-1", [first]);
    expect(projection.status).toBe("running");
    expect(projection.lastSequence).toBe(1);
  });
});

describe("countConsecutiveTurnSignature", () => {
  it("counts backward until the signature changes", () => {
    const events: SessionEvent[] = [
      createSessionEvent(
        "session-1",
        1,
        {
          eventType: "turn.completed",
          occurredAt: "2026-09-03T00:00:00.0000000+00:00",
          payload: validSessionEventPayload("turn.completed", {
            turnNumber: 1,
            actionSignature: HASH_A
          })
        },
        EMPTY_HASH
      )
    ];
    events.push(
      createSessionEvent(
        "session-1",
        2,
        {
          eventType: "turn.completed",
          occurredAt: "2026-09-03T00:00:01.0000000+00:00",
          payload: validSessionEventPayload("turn.completed", {
            turnNumber: 2,
            actionSignature: HASH_A
          })
        },
        events[0]?.eventHash ?? EMPTY_HASH
      )
    );
    expect(countConsecutiveTurnSignature(events, HASH_A)).toBe(2);
    expect(countConsecutiveTurnSignature(events, HASH_B)).toBe(0);
    expect(() => countConsecutiveTurnSignature(events, "")).toThrow("signature is required");
  });
});
