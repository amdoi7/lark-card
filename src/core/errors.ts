const errorCodes = [
  'usage_invalid',
  'locale_invalid',
  'card_json_invalid',
  'card_compile_failed',
  'card_component_failed',
  'migration_source_invalid',
  'migration_requires_shared',
  'migration_requires_manual',
  'migration_locale_structure_mismatch',
  'batch_output_exists',
  'request_too_large',
  'assets_unavailable',
  'client_unavailable',
  'compiler_timeout',
  'compiler_runtime_failed',
  'simulator_empty_card',
  'simulator_render_failed',
  'render_failed',
] as const;

export type ErrorCode = (typeof errorCodes)[number];
const knownCodes: ReadonlySet<string> = new Set(errorCodes);

export class CardError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// Only known codes survive a thread, page or process boundary; unknown codes use the caller's fallback.
export function asCardError(error: unknown, fallback: ErrorCode): CardError {
  if (error instanceof CardError) return error;
  if (error instanceof SuppressedError) {
    const primary = asCardError(error.suppressed, fallback);
    const cleanup = asCardError(error.error, fallback);
    return new CardError(
      primary.code,
      `${primary.message} Cleanup also failed: ${cleanup.message}`,
      primary.details,
    );
  }
  const { code, message, details } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  const known = typeof code === 'string' && knownCodes.has(code);
  return new CardError(
    known ? (code as ErrorCode) : fallback,
    typeof message === 'string' ? message : String(error),
    details,
  );
}
