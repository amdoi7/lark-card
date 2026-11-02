import { pathToFileURL } from 'node:url';
import { parentPort } from 'node:worker_threads';
import { cachedAssetPath, readCachedAsset } from '../../assets/cache.ts';
import { transformNodes } from '../../core/schema.ts';
import { asCardError, CardError } from '../../core/errors.ts';
import type { CompilerOutput, CompilerRequest, CompilerResponse } from './protocol.ts';

declare const Go: new () => {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};
declare function injectWasm(...args: string[]): { error?: string };
declare function parseUserDSL(
  card: string,
  variables: string,
  locale: string,
): {
  error?: string;
  cardDsl?: Record<string, unknown>;
  attachmentMeta: unknown;
  warning?: string;
};

if (!parentPort) throw Error('The compiler must run in a worker thread.');
const port = parentPort;
function send(message: CompilerResponse) {
  port.postMessage(message);
}
function fatal(error: unknown): never {
  const failure = asCardError(error, 'compiler_runtime_failed');
  send({
    error: { code: failure.code, message: failure.message, details: failure.details },
  });
  process.exit(1);
}

function compile(request: CompilerRequest): CompilerOutput {
  const result = parseUserDSL(
    JSON.stringify(request.card),
    JSON.stringify(request.variables),
    request.locale,
  );
  if (result.error)
    throw new CardError('card_compile_failed', 'The CardKit compiler rejected the card.', {
      message: result.error,
    });
  if (!result.cardDsl || typeof result.cardDsl !== 'object')
    throw Error('The compiler returned an invalid card.');
  if (result.cardDsl.schema !== request.card.schema)
    throw Error('The compiler returned a different card schema.');
  const failures: { path: string; tag: unknown; code: unknown; message: unknown }[] = [];
  transformNodes(result.cardDsl, (node, path) => {
    if (node.tag && node.errCode)
      failures.push({ path, tag: node.tag, code: node.errCode, message: node.errMessage });
    return node;
  });
  if (failures.length)
    throw new CardError(
      'card_component_failed',
      'The CardKit compiler returned failed components.',
      failures,
    );
  return {
    card: result.cardDsl,
    attachment: result.attachmentMeta,
    warnings: result.warning ? JSON.parse(result.warning) : [],
  };
}

try {
  console.log = () => {};
  Object.assign(globalThis, { window: globalThis });
  await import(pathToFileURL(cachedAssetPath('wasm_exec.js')).href);
  const go = new Go();
  const module = await WebAssembly.compile(readCachedAsset('cardkit-parser.wasm'));
  const instance = await WebAssembly.instantiate(module, go.importObject);
  go.run(instance).then(() => fatal(Error('The compiler runtime stopped.')), fatal);
  const initialization: unknown = JSON.parse(readCachedAsset('compiler-init.json').toString());
  if (
    !Array.isArray(initialization) ||
    initialization.length !== 3 ||
    !initialization.every((value) => typeof value === 'string')
  ) {
    throw new CardError(
      'assets_unavailable',
      'Compiler initialization must contain three strings. Run bun run setup-assets.',
    );
  }
  const injected = injectWasm(...initialization);
  if (injected.error) throw Error(`Compiler initialization failed: ${injected.error}`);
  port.on('message', (request: CompilerRequest) => {
    try {
      send(compile(request));
    } catch (error) {
      const failure = asCardError(error, 'compiler_runtime_failed');
      if (failure.code !== 'card_compile_failed' && failure.code !== 'card_component_failed')
        fatal(failure);
      send({
        error: { code: failure.code, message: failure.message, details: failure.details },
      });
    }
  });
} catch (error) {
  fatal(error);
}
