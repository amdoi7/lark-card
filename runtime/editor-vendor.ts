import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { cacheDirectory, type EditorAsset } from './assets.ts';

const assets: EditorAsset[] = JSON.parse(readFileSync(new URL('./editor-assets.json', import.meta.url), 'utf8'));
const base = 'https://sf1-scmcdn-cn.feishucdn.com/obj/feishu-static/lark/cardkit/builder';

export function loadEditorAssets() {
  const result = new Map<string, Buffer>();
  for (const asset of assets) {
    const data = readFileSync(join(cacheDirectory, asset.file));
    if (createHash('sha256').update(data).digest('hex') !== asset.sha256) throw Error(`editor_asset_integrity_mismatch file=${asset.file} action="bun run setup-assets"`);
    result.set(asset.route, data);
  }
  const generated: Record<string, string> = JSON.parse(readFileSync(join(cacheDirectory, 'editor/generated.json'), 'utf8'));
  for (const [file, sha256] of Object.entries(generated)) {
    const data = readFileSync(join(cacheDirectory, 'editor', file));
    if (createHash('sha256').update(data).digest('hex') !== sha256) throw Error(`editor_generated_integrity_mismatch file=${file}`);
    if (file === 'registry.mjs') result.set('/editor-registry.mjs', data);
    else {
      const name = file.split('.')[0];
      const asset = assets.find(asset => asset.kind === 'material' && asset.route.includes(`/${name}.`));
      result.set(asset!.route, data);
    }
  }
  for (const [route, bytes] of result) {
    if (!['.js', '.mjs', '.css'].includes(extname(route))) continue;
    let source = bytes.toString().replaceAll(base, '/cardkit').replaceAll(base.replace('https:', ''), '/cardkit');
    for (const asset of assets.filter(asset => ['external', 'simulator-runtime'].includes(asset.kind))) source = source.replaceAll(asset.url, asset.route);
    source = source.replaceAll('https://unpkg.byted-static.com/nclc/designer/', '/nclc/designer/');
    source = source.replace('baseUrl: `https://${apiHost}`', 'baseUrl: window.location.origin');
    if (route.endsWith('/simulator-runtime.production.min.js')) source += '\nNCLCSimulatorRuntime.runtime.run();\n';
    result.set(route, Buffer.from(source));
  }
  return result;
}

export const editorStyles = assets.filter(asset => asset.kind === 'css' || asset.route === '/editor-assets/universe.css').map(asset => asset.route);
