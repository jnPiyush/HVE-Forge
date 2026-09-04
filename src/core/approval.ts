import type { ActionClass } from "./policy.js";

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly runId: string;
  readonly requesterId: string;
  readonly actionClass: ActionClass;
  readonly actionHash: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
}

export interface HumanApproval {
  readonly approvalId: string;
  readonly approverId: string;
  readonly actionHash: string;
  readonly approved: boolean;
  readonly decidedAt: Date;
}

export interface ApprovalGateDecision {
  readonly isAllowed: boolean;
  readonly reason: string;
}

export function evaluateApproval(
  request: ApprovalRequest,
  approval: HumanApproval | null,
  now: Date
): ApprovalGateDecision {
  if (request.actionClass === "read" || request.actionClass === "workspace_write") {
    return { isAllowed: true, reason: "Action does not require high-risk approval." };
  }
  if (now.getTime() >= request.expiresAt.getTime()) {
    return { isAllowed: false, reason: "Approval request expired." };
  }
  if (approval === null) {
    return { isAllowed: false, reason: "A real human approval is required." };
  }
  if (
    !approval.approved ||
    approval.approvalId !== request.approvalId ||
    approval.actionHash !== request.actionHash
  ) {
    return { isAllowed: false, reason: "Approval does not match the exact requested action." };
  }
  if (!approval.approverId.startsWith("human:") || approval.approverId.length <= 6) {
    return {
      isAllowed: false,
      reason: "Agent or model identities cannot grant human approval."
    };
  }
  if (
    approval.decidedAt.getTime() < request.requestedAt.getTime() ||
    approval.decidedAt.getTime() > now.getTime()
  ) {
    return { isAllowed: false, reason: "Approval decision time is invalid." };
  }
  return { isAllowed: true, reason: "Exact action approved by a human identity." };
}
