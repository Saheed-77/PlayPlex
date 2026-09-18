import type { LiveEventType, Role } from '@/types/api'
import type { ErrorCode, ProblemDetail } from '@/api/errors'
import type { Db, DbStaff } from './db'

// Shared plumbing for the mock route handlers.
export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly detail: string,
    readonly errors?: Record<string, string>,
  ) {
    super(detail)
  }
  toProblem(path: string): ProblemDetail {
    return {
      type: `https://playplex.local/errors/${this.code.toLowerCase().replace(/_/g, '-')}`,
      title: this.code.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      status: this.status,
      detail: this.detail,
      code: this.code,
      instance: `/api${path}`,
      errors: this.errors,
    }
  }
}

export const fail = (status: number, code: ErrorCode, detail: string, errors?: Record<string, string>): never => {
  throw new Problem(status, code, detail, errors)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = Record<string, any>

export interface Ctx {
  db: Db
  now: number
  user: DbStaff
  body: Body
  query: URLSearchParams
  params: Record<string, string>
  emit: (type: LiveEventType, data?: Record<string, unknown>) => void
  audit: (action: string, entityType: string, entityId: number | null, entityLabel: string | null, before?: Record<string, unknown> | null, after?: Record<string, unknown> | null) => void
  dirty: () => void
}

type Handler = (ctx: Ctx) => unknown

export interface RouteDef {
  method: string
  path: string
  roles: Role[] | 'public' | 'any'
  handler: Handler
  /** Idempotency-Key required (docs/04 §1). */
  idempotent?: boolean
  mutates?: boolean
}


