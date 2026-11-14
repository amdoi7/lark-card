import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilerVersion, readCachedAsset, remoteAssets } from '../../assets/cache.ts';
import { editorStyles, loadEditorAssets } from '../../assets/editor-vendor.ts';
import { supportedLocales } from '../../core/locales.ts';
import { compileCard, migrateCard } from '../compiler/index.ts';
import { asCardError, CardError } from '../../core/errors.ts';
import { httpStatus } from './http-errors.ts';
import { Asar } from './asar.ts';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const root = join(sourceRoot, '..');
const defaultWebcontent =
  '/Applications/Lark.app/Contents/Frameworks/Lark Framework.framework/Resources/webcontent';
const nativePrefix = 'native-resource://sandbox_fs/webcontent/';
const bootstrapMarker = ';import{__webpack_require__ as e}from';
const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
};
const pages = new Map(
  [
    ['/', 'browser/editor.html'],
    ['/editor', 'browser/editor.html'],
    ['/preview', 'browser/preview.html'],
  ].map(([route, file]) => [route, join(sourceRoot, file)]),
);
const examples = new Map(
  ['basic', 'project-assistant', 'project-assistant-legacy'].map((name) => [
    `/examples/${name}.card.json`,
    join(root, 'examples', `${name}.card.json`),
  ]),
);
// Modules the browser imports, served at their source path so relative imports resolve unchanged.
const browserModules = [
  'core/schema.ts',
  'core/locales.ts',
  'core/errors.ts',
  'browser/editor.ts',
  'browser/runtime.ts',
  'browser/webpack.ts',
  'browser/editor-frame.ts',
  'browser/inspect-cardkit.ts',
];
const maxBodyBytes = 3_000_000;

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0,
      oversized = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        if (!oversized)
          reject(
            new CardError('request_too_large', `request_too_large limit_bytes=${maxBodyBytes}`),
          );
        oversized = true;
        chunks.length = 0;
      } else if (!oversized) chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('aborted', () => reject(new CardError('render_failed', 'request_aborted')));
    request.once('end', () => {
      if (oversized) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new CardError('card_json_invalid', '请求体不是合法 JSON'));
      }
    });
  });
}

export async function startPreviewServer({
  webcontent,
  port = 4173,
  renderer = 'simulator',
}: { webcontent?: string; port?: number; renderer?: 'simulator' | 'client' } = {}) {
  const editorAssets = loadEditorAssets();
  const transpiler = new Bun.Transpiler({ loader: 'ts' });
  const browserScripts = new Map(
    browserModules.map((file) => [
      `/${file}`,
      transpiler.transformSync(readFileSync(join(sourceRoot, file), 'utf8')),
    ]),
  );
  let larkClient:
    | {
        archives: Record<string, Asar>;
        entry: string;
        source: string;
        bootstrap: number;
        webcontent: string;
        sha256: string;
      }
    | undefined;
  if (renderer === 'client') {
    const clientPath =
      webcontent ?? (process.platform === 'darwin' ? defaultWebcontent : undefined);
    if (!clientPath)
      throw new CardError(
        'client_unavailable',
        'client_webcontent_required action="provide --webcontent for the installed Lark client"',
      );
    const archives: Record<string, Asar> = Object.fromEntries(
      ['messenger', 'resource', 'shared-libs'].map((name) => [
        name,
        new Asar(join(clientPath, `${name}.asar`)),
      ]),
    );
    const entries = [...archives.messenger.files.keys()].filter(
      (path) => path.startsWith('universal-card-viewer/') && path.endsWith('.js'),
    );
    if (entries.length !== 1)
      throw new CardError(
        'client_unavailable',
        `renderer_entry_ambiguous count=${entries.length} webcontent=${clientPath}`,
      );
    const entry = entries[0],
      bytes = archives.messenger.read(entry)!;
    const source = bytes.toString(),
      bootstrap = source.indexOf(bootstrapMarker);
    if (bootstrap < 0)
      throw new CardError(
        'client_unavailable',
        `renderer_bootstrap_unknown entry=${entry} action="inspect the installed client entry before adapting it"`,
      );
    larkClient = {
      archives,
      entry,
      source,
      bootstrap,
      webcontent: realpathSync(clientPath),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  const cached = new Map<string, Buffer>();
  for (const asset of remoteAssets) {
    const data = readCachedAsset(asset.file);
    if (createHash('sha256').update(data).digest('hex') !== asset.sha256)
      throw new CardError('assets_unavailable', `asset_cache_corrupt file=${asset.file}`);
    if (!asset.private) cached.set(asset.file, data);
  }
  JSON.parse(readCachedAsset('compiler-init.json').toString());
  const runtimeInfo = {
    renderer,
    ...(larkClient
      ? {
          entry: larkClient.entry,
          html: 'universal-card-viewer/zh-CN.html',
          engineModule: 806689,
          sha256: larkClient.sha256,
          source: larkClient.webcontent,
          adapter:
            'native-resource URLs mapped to localhost; viewer application bootstrap excluded; render modules unchanged',
        }
      : {}),
    input: 'feishu-card-json',
    compiler: compilerVersion,
    compilerSha256: remoteAssets.find((asset) => asset.file === 'cardkit-parser.wasm')!.sha256,
    locales: supportedLocales,
  };
  const server = createServer(async (request, response) => {
    const send = (status: number, body: string | Buffer, type = 'text/plain') => {
      response.writeHead(status, {
        'Content-Type': `${type}; charset=utf-8`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      });
      response.end(body);
    };
    try {
      const expectedHost = `127.0.0.1:${(server.address() as AddressInfo).port}`;
      if (request.headers.host !== expectedHost) return send(403, 'host_not_allowed');
      const path = decodeURIComponent(new URL(request.url!, `http://${expectedHost}`).pathname);
      if (['/api/compile', '/api/migrate'].includes(path)) {
        if (request.method !== 'POST') return send(405, 'method_not_allowed');
        if (request.headers.origin !== `http://${expectedHost}`)
          return send(403, 'origin_not_allowed');
        if (request.headers['content-type']?.split(';')[0] !== 'application/json')
          return send(415, 'content_type_not_supported');
        try {
          const input = (await readJsonBody(request)) as {
            card?: unknown;
            locale?: string;
            variables?: unknown[];
            allowShared?: boolean;
          } | null;
          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            !Object.hasOwn(input, 'card')
          ) {
            throw new CardError('card_json_invalid', '请求体需要 card 字段');
          }
          const result =
            path === '/api/compile'
              ? await compileCard(input.card, input.locale, input.variables)
              : await migrateCard(input.card, {
                  locale: input.locale,
                  variables: input.variables,
                  allowShared: input.allowShared,
                });
          return send(200, JSON.stringify(result), mime['.json']);
        } catch (caught) {
          const error = asCardError(caught, 'compiler_runtime_failed');
          return send(
            httpStatus(error.code),
            JSON.stringify({ code: error.code, message: error.message, details: error.details }),
            mime['.json'],
          );
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return send(405, 'method_not_allowed');
      if (path === '/runtime-info.json')
        return send(200, JSON.stringify(runtimeInfo), mime['.json']);
      if (path === '/favicon.ico') return send(204, '');
      if (browserScripts.has(path))
        return send(
          200,
          request.method === 'HEAD' ? '' : browserScripts.get(path)!,
          mime[extname(path)],
        );
      if (path === '/settings/v3/')
        return send(
          200,
          JSON.stringify({
            data: { biz_domain_config: { api: [expectedHost] }, feature_gating: {} },
            meta: { complete: true },
          }),
          mime['.json'],
        );
      if (editorAssets.has(path))
        return send(
          200,
          request.method === 'HEAD' ? '' : editorAssets.get(path)!,
          mime[extname(path)],
        );
      if (path.startsWith('/assets/')) {
        const data = cached.get(path.slice('/assets/'.length));
        return data
          ? send(200, request.method === 'HEAD' ? '' : data, mime[extname(path)])
          : send(404, 'asset_not_found');
      }
      if (path.startsWith('/vendor/')) {
        if (!larkClient) return send(404, 'asset_not_found');
        const [name, ...parts] = path.slice('/vendor/'.length).split('/');
        const file = parts.join('/');
        let data = Object.hasOwn(larkClient.archives, name)
          ? larkClient.archives[name].read(file)
          : undefined;
        if (!data) return send(404, 'asset_not_found');
        if (name === 'messenger' && file === larkClient.entry)
          data = Buffer.from(larkClient.source.slice(0, larkClient.bootstrap) + ';');
        const extension = extname(file);
        if (['.js', '.css', '.html'].includes(extension)) {
          let text = data.toString().replaceAll(nativePrefix, '/vendor/');
          for (const asset of remoteAssets)
            text = text.replaceAll(asset.url, `/assets/${asset.file}`);
          data = Buffer.from(text);
        }
        return send(
          200,
          request.method === 'HEAD' ? '' : data,
          mime[extension] || 'application/octet-stream',
        );
      }
      if (path === '/preview' && !larkClient)
        return send(404, 'client_renderer_unavailable; start with --renderer client');
      const file = pages.get(path) ?? examples.get(path);
      if (!file) return send(404, 'route_not_found');
      let data = readFileSync(file);
      if (pages.has(path))
        data = Buffer.from(
          data
            .toString()
            .replace(
              '<!--EDITOR_STYLES-->',
              editorStyles
                .map((route: string) => `<link rel="stylesheet" href="${route}">`)
                .join(''),
            ),
        );
      return send(200, request.method === 'HEAD' ? '' : data, mime[extname(file)]);
    } catch (error) {
      console.error(
        JSON.stringify({
          operation: 'preview.serve',
          path: request.url,
          error: (error as Error).message,
        }),
      );
      return send(500, 'preview_asset_error; see server diagnostics');
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 15000;
  await new Promise<void>((ready, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', ready);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    runtimeInfo,
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeIdleConnections();
      }),
  };
}
