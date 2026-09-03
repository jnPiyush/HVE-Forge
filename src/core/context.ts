export type ContinuityAction = "continue" | "compact" | "reset_with_handoff" | "stop";

export interface ContextSignals {
  readonly usedTokens: number;
  readonly maximumTokens: number;
  readonly reservedOutputTokens: number;
  readonly repeatedReads: number;
  readonly goalDrift: boolean;
  readonly stalePlan: boolean;
  readonly validatedHandoffAvailable: boolean;
}

export interface ContinuityDecision {
  readonly action: ContinuityAction;
  readonly reason: string;
}

export function decideContinuity(signals: ContextSignals): ContinuityDecision {
  validateSignals(signals);
  const inputBudget = signals.maximumTokens - signals.reservedOutputTokens;
  if (signals.usedTokens >= inputBudget) {
    return signals.validatedHandoffAvailable
      ? {
          action: "reset_with_handoff",
          reason: "Input budget exhausted; resume from validated handoff."
        }
      : { action: "stop", reason: "Input budget exhausted without a validated handoff." };
  }
  if (signals.goalDrift || signals.stalePlan) {
    return signals.validatedHandoffAvailable
      ? {
          action: "reset_with_handoff",
          reason: "Goal or plan state drifted from durable artifacts."
        }
      : { action: "stop", reason: "Goal or plan drift requires a handoff before continuing." };
  }
  const saturationBasisPoints = Math.floor((signals.usedTokens * 10_000) / inputBudget);
  if (saturationBasisPoints >= 8_000 || signals.repeatedReads >= 3) {
    return {
      action: "compact",
      reason: "Context pressure is high while task state remains coherent."
    };
  }
  return { action: "continue", reason: "Context budget and durable task state are healthy." };
}

function validateSignals(signals: ContextSignals): void {
  for (const [name, value] of [
    ["usedTokens", signals.usedTokens],
    ["maximumTokens", signals.maximumTokens],
    ["reservedOutputTokens", signals.reservedOutputTokens],
    ["repeatedReads", signals.repeatedReads]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer.`);
    }
  }
  if (signals.maximumTokens < 1) throw new RangeError("maximumTokens must be positive.");
  if (signals.reservedOutputTokens >= signals.maximumTokens) {
    throw new RangeError("Reserved output must be smaller than the context window.");
  }
}
