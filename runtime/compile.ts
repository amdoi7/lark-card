import { Worker } from 'node:worker_threads';
import { cardError, prepareCard } from './input.ts';

type CompilerOutput = {
  card: unknown;
  attachment: unknown;
  warnings: unknown[];
};

type CompilerMessage = CompilerOutput | {
  error: { code: string; message: string; details?: unknown };
};

export async function compileCard(input: unknown, locale = 'zh_cn', variables: unknown = []) {
  if (!Array.isArray(variables)) throw cardError('card_json_invalid', 'variables 必须是官方变量描述数组');
  const normalized = prepareCard(input, locale);
  const worker = new Worker(new URL('./compiler-worker.ts', import.meta.url), {
    workerData: { card: normalized.card, locale: normalized.locale, variables },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await new Promise<CompilerOutput>((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(Error('compiler_timeout limit_ms=15000'), { code: 'compiler_timeout' })), 15000);
      worker.once('message', (message: CompilerMessage) => {
        if ('error' in message) reject(Object.assign(Error(message.error.message), { code: message.error.code, details: message.error.details }));
        else resolve(message);
      });
      worker.once('error', reject);
      worker.once('exit', code => reject(Object.assign(Error(`compiler_exited code=${code}`), { code: 'compiler_runtime_failed' })));
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
