import { EvidenceDomainError, EvidenceErrorCode } from "./errors.js";
import { containsControlCharacters } from "./control-characters.js";

export type EvidenceIntakeStatus = "received" | "validating" | "accepted" | "rejected";

export interface EvidenceIntake {
  readonly id: string;
  readonly status: EvidenceIntakeStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly rejectionCode?: string;
}

export function createEvidenceIntake(id: string, createdAt: string): EvidenceIntake {
  if (!isValidIdentifier(id) || !isTimestamp(createdAt)) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_INTAKE, "Intake requires a non-empty identifier and a canonical UTC timestamp (YYYY-MM-DDTHH:mm:ss.sssZ).");
  }
  return Object.freeze({ id, status: "received", createdAt, updatedAt: createdAt });
}

export function transitionEvidenceIntake(
  intake: EvidenceIntake,
  nextStatus: EvidenceIntakeStatus,
  occurredAt: string,
  rejectionCode?: string,
): EvidenceIntake {
  if (!isValidIntake(intake) || !isTimestamp(occurredAt) || Date.parse(occurredAt) < Date.parse(intake.updatedAt)) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_INTAKE, "Intake record or transition timestamp is invalid, or the timestamp precedes the current state.");
  }
  const allowed: Readonly<Record<EvidenceIntakeStatus, readonly EvidenceIntakeStatus[]>> = {
    received: ["validating", "rejected"],
    validating: ["accepted", "rejected"],
    accepted: [],
    rejected: [],
  };
  if (!allowed[intake.status]?.includes(nextStatus)) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_INTAKE_TRANSITION, "Intake lifecycle transition is not allowed.", { from: intake.status, to: nextStatus });
  }
  if (nextStatus === "rejected" && (typeof rejectionCode !== "string" || rejectionCode.length === 0 || containsControlCharacters(rejectionCode))) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_INTAKE, "A rejected intake requires a stable rejection code.");
  }
  if (nextStatus !== "rejected" && rejectionCode !== undefined) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_INTAKE, "Only rejected intake transitions may include a rejection code.");
  }

  return Object.freeze({
    id: intake.id,
    status: nextStatus,
    createdAt: intake.createdAt,
    updatedAt: occurredAt,
    ...(nextStatus === "rejected" ? { rejectionCode } : {}),
  });
}

function isTimestamp(value: string): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isValidIdentifier(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0 && !containsControlCharacters(id);
}

function isValidIntake(intake: EvidenceIntake): boolean {
  if (intake === null || typeof intake !== "object" ||
    !isValidIdentifier(intake.id) ||
    !isTimestamp(intake.createdAt) || !isTimestamp(intake.updatedAt) ||
    Date.parse(intake.updatedAt) < Date.parse(intake.createdAt)) {
    return false;
  }

  const isKnownStatus = intake.status === "received" || intake.status === "validating" ||
    intake.status === "accepted" || intake.status === "rejected";
  if (!isKnownStatus) {
    return false;
  }

  if (intake.status === "rejected") {
    return typeof intake.rejectionCode === "string" && intake.rejectionCode.length > 0 &&
      !containsControlCharacters(intake.rejectionCode);
  }
  return intake.rejectionCode === undefined;
}
