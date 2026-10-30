import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type EditorAsset = { file: string; url: string; route: string; kind: string; sha256: string };

export async function prepareAsset(
  asset: { file: string; url: string; sha256: string },
  options: { timeout: number; downloadError(status: number): string; integrityError(target: string, actual: string): string },
) {
  const target = join(cacheDirectory, asset.file);
  let data: Buffer | undefined;
  try { data = await readFile(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!data) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(options.timeout) });
    if (!response.ok) throw Error(options.downloadError(response.status));
    data = Buffer.from(await response.arrayBuffer());
  }
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== asset.sha256) throw Error(options.integrityError(target, actual));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  return data;
}

export const cacheDirectory = process.env.LARK_CARD_CACHE || join(homedir(), '.cache', 'lark-card');
export const compilerVersion = 'CardKit 1.0.0.2738 / bd8f4d9746b374241e86a9beaf1a573b2981deab';
export const remoteAssets = [
  {
    file: 'SourceCodePro2.woff2',
    url: 'https://sf3-scmcdn2-cn.feishucdn.com/ccm/pc/web/resource/bear/fonts/SourceCodePro2.woff2',
    sha256: 'caa7cde440040efaf6a17ee2e62e2ce17e72b648dd074d582629f65795b7d429',
  },
  {
    file: 'cardkit-parser.wasm',
    url: 'https://sf1-scmcdn-cn.feishucdn.com/obj/feishu-static/lark/cardkit/builder/static/wasm/21ebb57b048e373c.module.wasm',
    sha256: '1b3276cf6c070d16db1502c139b2d327e9408713901a8b08b9a28b066f699c25',
    private: true,
  },
  {
    file: 'wasm_exec.js',
    url: 'https://raw.githubusercontent.com/golang/go/go1.21.13/misc/wasm/wasm_exec.js',
    sha256: '45ce9dfe7211247544ab6f4268eb8cb5b6f3d5ae602dc3b51447b7eada99c229',
    private: true,
  },
  {
    file: 'cardkit-main.js',
    url: 'https://sf1-scmcdn-cn.feishucdn.com/obj/feishu-static/lark/cardkit/builder/static/js/main-42f9d7e6.f032c87f.js',
    sha256: 'a72a19bb07e38254c86dbec472e854f46488bb1ff9312768fd61dc974a4328ae',
    private: true,
  },
];
