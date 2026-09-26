export const READINESS_PROBE = Symbol('READINESS_PROBE');

export interface ReadinessProbe {
  check(): Promise<void>;
}
