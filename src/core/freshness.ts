export const FRESHNESS_GRADES = ["FRESH", "STALE", "MISSING"] as const;
export type FreshnessGrade = (typeof FRESHNESS_GRADES)[number];

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Grades evidence freshness against a working-tree fingerprint (SPEC-004 section 5.2).
 * `MISSING` when no evidence fingerprint was recorded, `STALE` when one was recorded but no
 * longer matches the current fingerprint, `FRESH` when they match exactly. Completion gates
 * must accept `FRESH` only; `STALE` and `MISSING` carry distinct, actionable messages so a
 * caller never has to guess which condition blocked it.
 */
export function gradeFreshness(
  recordedFingerprint: string | null,
  currentFingerprint: string
): FreshnessGrade {
  if (!SHA256.test(currentFingerprint)) {
    throw new TypeError("currentFingerprint must be a lowercase SHA-256 value.");
  }
  if (recordedFingerprint === null) return "MISSING";
  if (!SHA256.test(recordedFingerprint)) {
    throw new TypeError("recordedFingerprint must be a lowercase SHA-256 value or null.");
  }
  return recordedFingerprint === currentFingerprint ? "FRESH" : "STALE";
}

export function freshnessMessage(grade: FreshnessGrade): string {
  switch (grade) {
    case "FRESH":
      return "Evidence fingerprint matches the current working tree.";
    case "STALE":
      return "Evidence fingerprint no longer matches the current working tree; recapture evidence.";
    case "MISSING":
      return "No working-tree fingerprint was recorded for this evidence.";
  }
}

export function assertFresh(grade: FreshnessGrade): void {
  if (grade !== "FRESH") throw new Error(freshnessMessage(grade));
}
