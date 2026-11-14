import type { ErrorCode } from '../../core/errors.ts';

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
  assets_unavailable: 500,
  client_unavailable: 500,
  compiler_timeout: 500,
  compiler_runtime_failed: 500,
  simulator_empty_card: 500,
  simulator_render_failed: 500,
  render_failed: 500,
} satisfies Record<ErrorCode, number>;

export function httpStatus(code: ErrorCode): number {
  return statuses[code];
}
