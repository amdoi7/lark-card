import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { cacheDirectory, compilerVersion, remoteAssets } from './assets.ts';
import { compileCard } from './compile.ts';
import { supportedLocales } from './input.ts';
import { migrateCard } from './migrate.ts';
import { editorStyles, loadEditorAssets } from './editor-vendor.ts';

const directory = dirname(fileURLToPath(import.meta.url));
const defaultWebcontent = '/Applications/Lark.app/Contents/Frameworks/Lark Framework.framework/Resources/webcontent';
const nativePrefix = 'native-resource://sandbox_fs/webcontent/';
const bootstrapMarker = ';import{__webpack_require__ as e}from';
const mime: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png' };
const localFiles = new Set(['index.html', 'editor.html', 'sample.json', 'examples/project-assistant.card.json', 'examples/project-assistant-legacy.card.json']);
const browserSources = new Map([['/input.ts', 'input.ts'], ['/editor.mjs', 'editor.ts'], ['/runtime.mjs', 'runtime.ts'], ['/webpack.ts', 'webpack.ts'], ['/editor-frame.js', 'editor-frame.ts'], ['/inspect-cardkit.js', 'inspect-cardkit.ts']]);
const bodyLimit = 3_000_000;

function jsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0, oversized = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > bodyLimit) {
        if (!oversized) reject(Object.assign(Error(`request_too_large limit_bytes=${bodyLimit}`), { status: 413, code: 'request_too_large' }));
        oversized = true;
        chunks.length = 0;
      } else if (!oversized) chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('aborted', () => reject(Error('request_aborted')));
    request.once('end', () => {
      if (oversized) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(Object.assign(Error('card_json_invalid: 请求体不是合法 JSON'), { status: 400, code: 'card_json_invalid' })); }
    });
  });
}

type AsarEntry = {
  files?: Record<string, AsarEntry>;
  link?: string;
  unpacked?: boolean;
  offset: string;
  size: number;
  integrity?: { algorithm: string; hash: string };
};

export class Asar {
  private readonly data: Buffer;
  private readonly base: number;
  readonly files: Map<string, AsarEntry>;

  constructor(filename: string) {
    this.data = readFileSync(filename);
    if (this.data.length < 16) throw Error(`asar_header_invalid file=${filename}`);
    const headerSize = this.data.readUInt32LE(12);
    this.base = 8 + this.data.readUInt32LE(4);
    if (this.data.readUInt32LE(0) !== 4 || headerSize > this.base - 16 || this.base > this.data.length) {
      throw Error(`asar_header_invalid file=${filename}`);
    }
    const header = JSON.parse(this.data.subarray(16, 16 + headerSize).toString());
    this.files = new Map();
    const visit = (node: AsarEntry, prefix = '') => {
      for (const [name, entry] of Object.entries(node.files!)) {
        const path = prefix + name;
        if (entry.files) visit(entry, path + '/');
        else if (!entry.link && !entry.unpacked) this.files.set(path, entry);
      }
    };
    visit(header);
  }

  read(path: string): Buffer | undefined {
    const entry = this.files.get(path);
    if (!entry) return undefined;
    const offset = Number(entry.offset), size = entry.size;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || this.base + offset + size > this.data.length) {
      throw Error(`asar_entry_invalid path=${path}`);
    }
    const bytes = this.data.subarray(this.base + offset, this.base + offset + size);
    const integrity = entry.integrity;
    if (integrity?.algorithm === 'SHA256' && createHash('sha256').update(bytes).digest('hex') !== integrity.hash) {
      throw Error(`asar_integrity_mismatch path=${path}`);
    }
    return bytes;
  }
}

export async function startPreview({ webcontent, port = 4173, renderer = 'simulator' }: { webcontent?: string; port?: number; renderer?: 'simulator' | 'client' } = {}) {
  const editorAssets = loadEditorAssets();
  const transpiler = new Bun.Transpiler({ loader: 'ts' });
  const browserScripts = new Map([...browserSources].map(([route, file]) => [route, transpiler.transformSync(readFileSync(join(directory, file), 'utf8'))]));
  let client: { archives: Record<string, Asar>; entry: string; source: string; bootstrap: number; webcontent: string; sha256: string } | undefined;
  if (renderer === 'client') {
    const clientPath = webcontent ?? (process.platform === 'darwin' ? defaultWebcontent : undefined);
    if (!clientPath) throw Error('client_webcontent_required action="provide --webcontent for the installed Lark client"');
    const archives: Record<string, Asar> = Object.fromEntries(['messenger', 'resource', 'shared-libs'].map(name => [name, new Asar(join(clientPath, `${name}.asar`))]));
    const entries = [...archives.messenger.files.keys()].filter(path => path.startsWith('universal-card-viewer/') && path.endsWith('.js'));
    if (entries.length !== 1) throw Error(`renderer_entry_ambiguous count=${entries.length} webcontent=${clientPath}`);
    const entry = entries[0], bytes = archives.messenger.read(entry)!;
    const source = bytes.toString(), bootstrap = source.indexOf(bootstrapMarker);
    if (bootstrap < 0) throw Error(`renderer_bootstrap_unknown entry=${entry} action="inspect the installed client entry before adapting it"`);
    client = { archives, entry, source, bootstrap, webcontent: realpathSync(clientPath), sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const cached = new Map<string, Buffer>();
  for (const asset of remoteAssets) {
    let data: Buffer;
    try { data = readFileSync(join(cacheDirectory, asset.file)); }
    catch (error) { throw Error(`asset_cache_unavailable file=${asset.file} cause=${(error as NodeJS.ErrnoException).code} action="bun run setup-assets"`); }
    if (createHash('sha256').update(data).digest('hex') !== asset.sha256) throw Error(`asset_cache_corrupt file=${asset.file}`);
    if (!asset.private) cached.set(asset.file, data);
  }
  JSON.parse(readFileSync(join(cacheDirectory, 'compiler-init.json'), 'utf8'));
  const manifest = {
    renderer,
    ...(client ? { entry: client.entry, html: 'universal-card-viewer/zh-CN.html', engineModule: 806689, sha256: client.sha256, source: client.webcontent, adapter: 'native-resource URLs mapped to localhost; viewer application bootstrap excluded; render modules unchanged' } : {}),
    input: 'feishu-card-json',
    compiler: compilerVersion,
    compilerSha256: remoteAssets.find(asset => asset.file === 'cardkit-parser.wasm')!.sha256,
    locales: supportedLocales,
  };
  const server = createServer(async (request, response) => {
    const send = (status: number, body: string | Buffer, type = 'text/plain') => {
      response.writeHead(status, {
        'Content-Type': `${type}; charset=utf-8`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      });
      response.end(body);
    };
    try {
      const expectedHost = `127.0.0.1:${(server.address() as AddressInfo).port}`;
      if (request.headers.host !== expectedHost) return send(403, 'host_not_allowed');
      const path = decodeURIComponent(new URL(request.url!, `http://${expectedHost}`).pathname);
      if (['/api/compile', '/api/migrate'].includes(path)) {
        if (request.method !== 'POST') return send(405, 'method_not_allowed');
        if (request.headers.origin !== `http://${expectedHost}`) return send(403, 'origin_not_allowed');
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, 'content_type_not_supported');
        try {
          const input = await jsonBody(request) as { card?: unknown; locale?: string; variables?: unknown[]; allowShared?: boolean } | null;
          if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(input, 'card')) {
            return send(400, JSON.stringify({ code: 'card_json_invalid', message: '请求体需要 card 字段' }), mime['.json']);
          }
          const result = path === '/api/compile'
            ? await compileCard(input.card, input.locale, input.variables)
            : await migrateCard(input.card, { locale: input.locale, variables: input.variables, allowShared: input.allowShared });
          return send(200, JSON.stringify(result), mime['.json']);
        } catch (caught) {
          const error = caught as Error & { status?: number; code?: string; details?: unknown };
          const invalid = ['card_json_invalid', 'card_compile_failed', 'card_component_failed'].includes(error.code as string) || error.code?.startsWith('migration_');
          return send(error.status || (invalid ? 400 : 500), JSON.stringify({ code: error.code || 'compiler_runtime_failed', message: error.message, details: error.details }), mime['.json']);
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'method_not_allowed');
      if (path === '/manifest.json') return send(200, JSON.stringify(manifest), mime['.json']);
      if (path === '/favicon.ico') return send(204, '');
      if (browserScripts.has(path)) return send(200, request.method === 'HEAD' ? '' : browserScripts.get(path)!, mime[extname(path)]);
      if (path === '/settings/v3/') return send(200, JSON.stringify({ data: { biz_domain_config: { api: [expectedHost] }, feature_gating: {} }, meta: { complete: true } }), mime['.json']);
      if (editorAssets.has(path)) return send(200, request.method === 'HEAD' ? '' : editorAssets.get(path)!, mime[extname(path)]);
      if (path.startsWith('/assets/')) {
        const data = cached.get(path.slice('/assets/'.length));
        return data ? send(200, request.method === 'HEAD' ? '' : data, mime[extname(path)]) : send(404, 'asset_not_found');
      }
      if (path.startsWith('/vendor/')) {
        if (!client) return send(404, 'asset_not_found');
        const [name, ...parts] = path.slice('/vendor/'.length).split('/');
        const file = parts.join('/');
        let data = Object.hasOwn(client.archives, name) ? client.archives[name].read(file) : undefined;
        if (!data) return send(404, 'asset_not_found');
        if (name === 'messenger' && file === client.entry) data = Buffer.from(client.source.slice(0, client.bootstrap) + ';');
        const extension = extname(file);
        if (['.js', '.css', '.html'].includes(extension)) {
          let text = data.toString().replaceAll(nativePrefix, '/vendor/');
          for (const asset of remoteAssets) text = text.replaceAll(asset.url, `/assets/${asset.file}`);
          data = Buffer.from(text);
        }
        return send(200, request.method === 'HEAD' ? '' : data, mime[extension] || 'application/octet-stream');
      }
      if (path === '/preview' && !client) return send(404, 'client_renderer_unavailable; start with --renderer client');
      const file = path === '/' || path === '/editor' ? 'editor.html' : path === '/preview' ? 'index.html' : path.slice(1);
      if (!localFiles.has(file)) return send(404, 'route_not_found');
      let data = readFileSync(join(directory, file));
      if (file === 'editor.html') data = Buffer.from(data.toString().replace('<!--EDITOR_STYLES-->', editorStyles.map((route: string) => `<link rel="stylesheet" href="${route}">`).join('')));
      return send(200, request.method === 'HEAD' ? '' : data, mime[extname(file)]);
    } catch (error) {
      console.error(JSON.stringify({ operation: 'preview.serve', path: request.url, error: (error as Error).message }));
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
    manifest,
    close: () => new Promise<void>((done, reject) => {
      server.close(error => error ? reject(error) : done());
      server.closeIdleConnections();
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { webcontent: { type: 'string' }, renderer: { type: 'string', default: 'simulator' }, port: { type: 'string', default: '4173' } } });
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error(`port_invalid value=${values.port}`);
    if (values.renderer !== 'simulator' && values.renderer !== 'client') throw Error(`renderer_invalid value=${values.renderer}`);
    if (values.webcontent && values.renderer !== 'client') throw Error('webcontent_requires_client action="add --renderer client"');
    const preview = await startPreview({ webcontent: values.webcontent, port, renderer: values.renderer });
    console.log(JSON.stringify({ operation: 'preview.ready', url: preview.url, ...preview.manifest }));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => preview.close().catch(error => { console.error(error); process.exitCode = 1; }));
  } catch (error) {
    console.error(JSON.stringify({ operation: 'preview.start', error: (error as Error).message, action: 'Check --renderer, --webcontent, --port and prepared assets.' }));
    process.exitCode = 1;
  }
}
