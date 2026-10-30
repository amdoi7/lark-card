import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { cacheDirectory, ensureAsset, type EditorAsset } from './cache.ts';

type Recipe = {
  hostModule: string;
  bindings: { name: string; start: number; end: number; kind: string }[];
  resourceBoundaries: Record<string, { start: number; end: number }>;
};

const assets: EditorAsset[] = JSON.parse(await readFile(new URL('./editor-assets.json', import.meta.url), 'utf8'));
const recipe: Recipe = JSON.parse(await readFile(new URL('./editor-recipe.json', import.meta.url), 'utf8'));
const modules: Record<string, { toString(): string }> = {};
const sources = new Map<string, string>();
let cursor = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < assets.length) {
    const asset = assets[cursor++];
    const data = await ensureAsset(asset, {
      timeout: 30000,
      downloadError: status => `editor_asset_download_failed status=${status} url=${asset.url}`,
      integrityError: () => `editor_asset_integrity_mismatch file=${asset.file}`,
    });
    if (['bundle', 'material'].includes(asset.kind)) sources.set(asset.route, data.toString());
  }
}));
const context = { self: { webpackChunkunified_builder: { push(data: [unknown, Record<string, { toString(): string }>]) { Object.assign(modules, data[1]); } } } };
for (const asset of assets.filter(asset => asset.kind === 'bundle')) runInNewContext(sources.get(asset.route)!, context, { timeout: 5000, filename: asset.file });
const host = `(${modules[recipe.hostModule].toString()})`;
const declarations = recipe.bindings.map(binding => {
  const text = host.slice(binding.start, binding.end);
  if (binding.kind !== 'expression' && !text.startsWith(binding.kind === 'function' ? `function ${binding.name}(` : binding.name)) throw Error(`editor_host_binding_mismatch name=${binding.name}`);
  return `${binding.kind === 'variable' ? 'var ' : ''}${text};`;
});
const supplied = `var T=t(795190).t;var Ge=function(error){window.CardBuilderSDKGlobalVar.monitor.error(error)};var Ci={getInstance:function(){return {report:window.CardBuilderSDKGlobalVar.report}}};var Ye=new Proxy({}, {get:function(_,name){return function(){throw Error('host_capability_unavailable operation='+name)}}});`;
modules[0] = `function(e,i,t){${supplied}${declarations.join('')}t.d(i,{variables:function(){return xr},boxDrawer:function(){return Ui},colors:function(){return Zi},createSubscription:function(){return gc},locales:function(){return Ri},sortedLocales:function(){return vi}})}`;
const i18n = modules[795190].toString();
const marker = 'n.d(t,{Uo:function(){return P},VQ:';
if (!i18n.includes(marker)) throw Error('editor_i18n_exports_unknown');
modules[795190] = i18n.replace(marker, 'n.d(t,{localI18n:function(){return K},Uo:function(){return P},VQ:');
const registry = `export const modules={${Object.entries(modules).map(([id, factory]) => `${JSON.stringify(id)}:${factory.toString()}`).join(',')}};\n`;
await writeFile(join(cacheDirectory, 'editor/registry.mjs'), registry);
for (const [name, range] of Object.entries(recipe.resourceBoundaries)) {
  const asset = assets.find(asset => asset.kind === 'material' && asset.route.includes(`/${name}.`));
  const source = sources.get(asset!.route)!;
  if (source[range.start] !== '{' || source[range.end - 1] !== '}') throw Error(`editor_resource_boundary_unknown asset=${name}`);
  const adapted = source.slice(0, range.start) + '{ return window.CardBuilderSDKGlobalVar.api.requestLocalResource(packet, throwErr); }' + source.slice(range.end);
  await writeFile(join(cacheDirectory, `editor/${name}.local.js`), adapted);
}
const generated: Record<string, string> = {};
for (const file of ['registry.mjs', ...Object.keys(recipe.resourceBoundaries).map(name => `${name}.local.js`)]) generated[file] = createHash('sha256').update(await readFile(join(cacheDirectory, 'editor', file))).digest('hex');
await writeFile(join(cacheDirectory, 'editor/generated.json'), JSON.stringify(generated));
console.log(JSON.stringify({ operation: 'editor.prepared', assets: assets.length, modules: Object.keys(modules).length, cache: join(cacheDirectory, 'editor') }));
