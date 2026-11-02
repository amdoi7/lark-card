import { Worker } from 'node:worker_threads';
import { asCardError, CardError } from '../../core/errors.ts';
import { toCompilerInput } from '../../core/input.ts';
import { convertV1ToV2 } from '../../core/migration.ts';
import type { CompilerOutput, CompilerRequest, CompilerResponse } from './protocol.ts';

let compiler: Worker | undefined;
let queue: Promise<void> = Promise.resolve();

function startCompiler(): Worker {
  const worker = new Worker(new URL('./worker.ts', import.meta.url));
  const forget = () => {
    if (compiler === worker) compiler = undefined;
  };
  worker.once('error', forget);
  worker.once('exit', forget);
  return worker;
}

async function requestCompiler(request: CompilerRequest): Promise<CompilerOutput> {
  const worker = (compiler ??= startCompiler());
  worker.ref();
  const response = Promise.withResolvers<CompilerOutput>();
  const onMessage = (message: CompilerResponse) => {
    if ('error' in message) response.reject(asCardError(message.error, 'compiler_runtime_failed'));
    else response.resolve(message);
  };
  const onError = (error: Error) => response.reject(asCardError(error, 'compiler_runtime_failed'));
  const onExit = (code: number) =>
    response.reject(
      new CardError('compiler_runtime_failed', `The compiler worker exited with code ${code}.`),
    );
  const timer = setTimeout(
    () =>
      response.reject(
        new CardError('compiler_timeout', 'Card compilation exceeded the 15000 ms time limit.'),
      ),
    15000,
  );
  worker.once('message', onMessage);
  worker.once('error', onError);
  worker.once('exit', onExit);
  try {
    try {
      worker.postMessage(request);
    } catch (error) {
      response.reject(asCardError(error, 'compiler_runtime_failed'));
    }
    return await response.promise;
  } catch (error) {
    const failure = asCardError(error, 'compiler_runtime_failed');
    if (failure.code !== 'card_compile_failed' && failure.code !== 'card_component_failed') {
      compiler = undefined;
      await worker.terminate();
    }
    throw failure;
  } finally {
    clearTimeout(timer);
    worker.off('message', onMessage);
    worker.off('error', onError);
    worker.off('exit', onExit);
    worker.unref();
  }
}

export type CompiledCard = Awaited<ReturnType<typeof compileCard>>;

export async function compileCard(input: unknown, locale = 'zh_cn', variables: unknown = []) {
  if (!Array.isArray(variables))
    throw new CardError(
      'card_json_invalid',
      'Variables must be an array of CardKit variable descriptions.',
    );
  const normalized = toCompilerInput(input, locale);
  const request: CompilerRequest = {
    card: normalized.card,
    locale: normalized.locale,
    variables: structuredClone(variables),
  };
  const result = queue.then(() => requestCompiler(request));
  // A failed card must not poison scheduling; its caller still receives the original rejection.
  queue = result.then(
    () => {},
    () => {},
  );
  const compiled = await result;
  return {
    ...compiled,
    sourceSchema: normalized.sourceSchema,
    locale: normalized.locale,
    warnings: [...normalized.warnings, ...compiled.warnings],
  };
}

export async function migrateCard(
  input: unknown,
  {
    locale,
    allowShared,
    variables,
  }: { locale?: string; allowShared?: boolean; variables?: unknown } = {},
) {
  const { card, warnings, chosen, locales } = convertV1ToV2(input, { locale, allowShared });
  const compiled = await compileCard(card, chosen, variables);
  for (const language of locales) {
    if (language !== chosen) await compileCard(card, language, variables);
  }
  return { card, compiled, warnings };
}
