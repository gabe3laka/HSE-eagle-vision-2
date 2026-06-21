/**
 * Compatibility shim — the Qwen-named heartbeat hook was renamed to the generic
 * `useReasonerHeartbeat` when the worker swapped its live scene reasoner from
 * Qwen to a worker-chosen model (e.g. Gemini). This module re-exports the new
 * generic implementation under the OLD Qwen names so any straggler import keeps
 * resolving. Prefer importing from `./useReasonerHeartbeat` directly.
 */

export {
  // Hook + handle
  useReasonerHeartbeat as useQwenHeartbeat,
  // Pure helpers (unchanged names — already generic)
  buildHeartbeatMonitoringRequest,
  pickHeartbeatDelay,
  pickEffectiveHeartbeatSessionId,
  hasReasonerUnavailableWarning,
  // Renamed pure helpers (old aliases)
  classifyReasonerLifecycle as classifyQwenLifecycle,
  isReasonerFailureResponse as isQwenFailureResponse,
  // Renamed constants (old aliases)
  REASONER_PENDING_STATES as QWEN_PENDING_STATES,
  REASONER_TERMINAL_SUCCESS_STATES as QWEN_TERMINAL_SUCCESS_STATES,
  REASONER_TERMINAL_FAILURE_STATES as QWEN_TERMINAL_FAILURE_STATES,
  REASONER_PENDING_HARD_MAX_MS as QWEN_PENDING_HARD_MAX_MS,
} from "./useReasonerHeartbeat";

export type {
  ReasonerLifecycle as QwenLifecycle,
  ReasonerHeartbeatResponse as QwenHeartbeatResponse,
  ReasonerHeartbeatDiagnostic as QwenHeartbeatDiagnostic,
  ReasonerHeartbeatHandle as QwenHeartbeatHandle,
  UseReasonerHeartbeatOptions as UseQwenHeartbeatOptions,
} from "./useReasonerHeartbeat";
