import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { cacheDirectory } from './assets.ts';
import { cardError, transformNodes } from './input.ts';

type CompilerGlobals = typeof globalThis & {
  Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
  injectWasm(...args: string[]): { error?: string };
  parseUserDSL(card: string, variables: string, locale: string): {
    error?: string;
    cardDsl?: Record<string, unknown>;
    attachmentMeta: unknown;
    warning?: string;
  };
};

type CompilerFailure = { path: string; tag: unknown; code: unknown; message: unknown };

const port = parentPort!;
const globals = globalThis as CompilerGlobals;

try {
  console.log = () => {};
  Object.assign(globalThis, { window: globalThis });
  await import(pathToFileURL(join(cacheDirectory, 'wasm_exec.js')).href);
  const go = new globals.Go();
  const bytes = await readFile(join(cacheDirectory, 'cardkit-parser.wasm'));
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance).catch(error => {
    port.postMessage({ error: { code: 'compiler_runtime_failed', message: error.message } });
  });
  const initialization: string[] = JSON.parse(await readFile(join(cacheDirectory, 'compiler-init.json'), 'utf8'));
  const injected = globals.injectWasm(...initialization);
  if (injected.error) throw Error(`compiler_initialization_failed: ${injected.error}`);
  const result = globals.parseUserDSL(JSON.stringify(workerData.card), JSON.stringify(workerData.variables), workerData.locale);
  if (result.error) throw Object.assign(Error(result.error), { code: 'card_compile_failed' });
  if (!result.cardDsl || typeof result.cardDsl !== 'object') throw Error('compiler_output_invalid');
  if (result.cardDsl.schema !== workerData.card.schema) throw Error('compiler_schema_mismatch');
  const failures: CompilerFailure[] = [];
  transformNodes(result.cardDsl, (node, path) => {
    if (node.tag && node.errCode) failures.push({ path, tag: node.tag, code: node.errCode, message: node.errMessage });
    return node;
  });
  if (failures.length) throw cardError('card_component_failed', '官方编译器返回失败组件，不能报告整卡成功', failures);
  port.postMessage({
    card: result.cardDsl,
    attachment: result.attachmentMeta,
    warnings: result.warning ? JSON.parse(result.warning) : [],
  });
} catch (error) {
  const failure = error as Error & { code?: string; details?: unknown };
  port.postMessage({ error: { code: failure.code || 'compiler_runtime_failed', message: failure.message, details: failure.details } });
}
