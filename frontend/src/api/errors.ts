// RFC 7807 problem details (docs/04 §1). `code` is the stable key the UI maps from.
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_AUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'INSUFFICIENT_ROLE'
  | 'NOT_FOUND'
  | 'DEVICE_NOT_AVAILABLE'
  | 'TICKET_NOT_QUEUED'
  | 'INVALID_TRANSITION'
  | 'SESSION_ALREADY_ENDED'
  | 'DUPLICATE_PHONE'
  | 'CAPACITY_EXCEEDED'
  | 'BUSINESS_RULE_VIOLATED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'

export interface ProblemDetail {
  type?: string
  title: string
  status: number
  detail: string
  code: ErrorCode
  instance?: string
  /** Field-level messages for VALIDATION_FAILED. */
  errors?: Record<string, string>
}

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly detail: string
  readonly fieldErrors: Record<string, string>

  constructor(p: ProblemDetail) {
    super(p.detail || p.title)
    this.status = p.status
    this.code = p.code
    this.detail = p.detail
    this.fieldErrors = p.errors ?? {}
  }
}

const FALLBACK: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Some fields need attention.',
  NOT_AUTHENTICATED: 'Please sign in again.',
  TOKEN_EXPIRED: 'Your session expired. Please sign in again.',
  INSUFFICIENT_ROLE: "Your role can't do that.",
  NOT_FOUND: 'That record no longer exists.',
  DEVICE_NOT_AVAILABLE: 'That device was just taken.',
  TICKET_NOT_QUEUED: 'That ticket is no longer waiting in the queue.',
  INVALID_TRANSITION: "That change isn't allowed right now.",
  SESSION_ALREADY_ENDED: 'That session has already ended.',
  DUPLICATE_PHONE: 'A student with this phone number already exists.',
  CAPACITY_EXCEEDED: 'Too many players for this device.',
  BUSINESS_RULE_VIOLATED: "That isn't allowed by the event rules.",
  INTERNAL_ERROR: 'Something went wrong on the server. Try again.',
  NETWORK_ERROR: "Can't reach the server. Check the Wi-Fi.",
}

/** A message that is always safe to put in a toast. Never a stack trace. */
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail || FALLBACK[err.code] || FALLBACK.INTERNAL_ERROR
  return FALLBACK.INTERNAL_ERROR
}
