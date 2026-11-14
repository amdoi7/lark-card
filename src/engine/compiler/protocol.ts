import type { CardDocument } from '../../core/schema.ts';
import type { ErrorCode } from '../../core/errors.ts';

export type CompilerRequest = { card: CardDocument; locale: string; variables: readonly unknown[] };
export type CompilerOutput = { card: unknown; attachment: unknown; warnings: unknown[] };
export type CompilerResponse =
  | CompilerOutput
  | { error: { code: ErrorCode; message: string; details?: unknown } };
