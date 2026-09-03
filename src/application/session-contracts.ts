import type {
  SessionEvaluationSummary,
  SessionVerificationSummary
} from "../core/session-completion.js";
import type { SessionEvent } from "../core/session-events.js";
import type { SessionAssetVersions, SessionLimits } from "../core/sessions.js";
import type {
  Clock,
  EvaluatorRubric,
  InstructionSelection,
  RuntimeContractValidator,
  WorkContract
} from "./contracts.js";

export type {
  Clock,
  EvaluatorRubric,
  InstructionSelection,
  RuntimeContractValidator,
  SessionAssetVersions,
  SessionLimits,
  WorkContract
};

/** Immutable bounded-session request. One session may run many turns and tool calls. */
export interface SessionDescriptor {
  readonly schemaVersion: "2.0";
  readonly sessionId: string;
  readonly parentSessionId: string | null;
  readonly taskId: string;
  readonly objective: string;
  readonly workspaceRoot: string;
  readonly stateRoot: string;
  readonly sourceFixturePath: string;
  readonly sourceFixtureHash: string;
  readonly targetRelativePath: string;
  readonly expectedText: string;
  readonly replacementText: string;
  readonly providerId: string;
  readonly workContractHash: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly limits: SessionLimits;
  readonly assets: SessionAssetVersions;
  readonly createdAt: string;
}

export interface SessionVerificationCheck {
  readonly criterionId: string;
  readonly passed: boolean;
  readonly observation: string;
}

export interface SessionVerificationArtifact {
  readonly summary: SessionVerificationSummary;
  readonly checks: readonly SessionVerificationCheck[];
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly instructionDigest: string;
  readonly sourceFixtureHash: string;
  readonly resultHash: string;
}

export interface SessionEvaluationArtifact {
  readonly summary: SessionEvaluationSummary;
  readonly scores: Readonly<Record<string, number>>;
  readonly evidenceHashes: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface SessionVerificationRequest {
  readonly descriptor: SessionDescriptor;
  readonly instruction: InstructionSelection;
  readonly eventChainHead: string;
  readonly turnNumber: number;
  readonly attemptNumber: number;
}

export interface SessionVerificationService {
  verify(request: SessionVerificationRequest): Promise<SessionVerificationArtifact>;
}

export interface SessionWorkspaceOps {
  computeHash(rootPath: string): Promise<string>;
}

export interface SessionEventSink {
  append(event: SessionEvent): Promise<void>;
}
