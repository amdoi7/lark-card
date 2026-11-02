// The closed set of error codes. Each maps to the HTTP status the preview server answers with;
// the CLI reports the same codes on stderr.
const statuses = {
  usage_invalid: 400,
  locale_invalid: 400,
  card_json_invalid: 400,
  card_compile_failed: 400,
  card_component_failed: 400,
  migration_source_invalid: 400,
  migration_requires_shared: 400,
  migration_requires_manual: 400,
  migration_locale_structure_mismatch: 400,
  batch_output_exists: 409,
  request_too_large: 413,
  assets_unavailable: 500, // run `bun run setup-assets`
  client_unavailable: 500, // check --webcontent and the installed Lark client
  compiler_timeout: 500,
  compiler_runtime_failed: 500,
  simulator_empty_card: 500,
  simulator_render_failed: 500,
  render_failed: 500,
} as const;

export type ErrorCode = keyof typeof statuses;

export class CardError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function httpStatus(code: ErrorCode): number {
  return statuses[code];
}

// Boundary adapter for failures that crossed a thread, page or process: only a known code survives,
// everything else is reported under `fallback`.
export function asCardError(error: unknown, fallback: ErrorCode): CardError {
  if (error instanceof CardError) return error;
  const { code, message, details } = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  const known = typeof code === 'string' && Object.hasOwn(statuses, code);
  return new CardError(
    known ? (code as ErrorCode) : fallback,
    typeof message === 'string' ? message : String(error),
    details,
  );
}
