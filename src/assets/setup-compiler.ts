import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { cacheDirectory, ensureAsset, remoteAssets } from './cache.ts';

await Promise.all(remoteAssets.map(async asset => {
  await ensureAsset(asset, {
    timeout: 20000,
    downloadError: status => `asset_download_failed url=${asset.url} status=${status}`,
    integrityError: (target, actual) => `asset_integrity_mismatch file=${target} expected=${asset.sha256} actual=${actual}`,
  });
  console.log(JSON.stringify({ operation: 'asset.ready', file: join(cacheDirectory, asset.file), sha256: asset.sha256 }));
}));
const source = await readFile(join(cacheDirectory, 'cardkit-main.js'), 'utf8');
const from = source.indexOf('null===(r=(o=window).injectWasm)');
const to = source.indexOf(',So=!0', from);
if (from < 0 || to < from) throw Error('compiler_initialization_not_found');
let initialization: string[] | undefined;
runInNewContext('let r,o;' + source.slice(from, to), {
  window: { injectWasm(...args: string[]) { initialization = args; } },
}, { timeout: 1000 });
if (initialization?.length !== 3 || initialization.some(value => typeof value !== 'string')) throw Error('compiler_initialization_invalid');
// The WASM requires a backup image key even for text-only cards; use CardKit's own default.
initialization[2] = 'img_v2_9dd98485-2900-4d65-ada9-e31d1408dcfg';
await writeFile(join(cacheDirectory, 'compiler-init.json'), JSON.stringify(initialization));
console.log(JSON.stringify({ operation: 'compiler.prepared', cache: cacheDirectory }));
