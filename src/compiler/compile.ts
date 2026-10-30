import { Worker } from 'node:worker_threads';
import { asCardError, CardError } from '../errors.ts';
import { toCompilerInput } from '../card/input.ts';

type CompilerOutput = {
  card: unknown;
  attachment: unknown;
  warnings: unknown[];
};

type CompilerMessage = CompilerOutput | { error: { code: string; message: string; details?: unknown } };

export type CompiledCard = Awaited<ReturnType<typeof compileCard>>;

export async function compileCard(input: unknown, locale = 'zh_cn', variables: unknown = []) {
  if (!Array.isArray(variables)) throw new CardError('card_json_invalid', 'variables 必须是官方变量描述数组');
  const normalized = toCompilerInput(input, locale);
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    workerData: { card: normalized.card, locale: normalized.locale, variables },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await new Promise<CompilerOutput>((resolve, reject) => {
      timer = setTimeout(() => reject(new CardError('compiler_timeout', 'compiler_timeout limit_ms=15000')), 15000);
      worker.once('message', (message: CompilerMessage) => {
        if ('error' in message) reject(asCardError(message.error, 'compiler_runtime_failed'));
        else resolve(message);
      });
      worker.once('error', error => reject(asCardError(error, 'compiler_runtime_failed')));
      worker.once('exit', code => reject(new CardError('compiler_runtime_failed', `compiler_exited code=${code}`)));
    });
    return {
      ...result,
      sourceSchema: normalized.sourceSchema,
      locale: normalized.locale,
      warnings: [...normalized.warnings, ...result.warnings],
    };
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
