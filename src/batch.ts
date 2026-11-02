import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCard, type CardProject } from './card/input.ts';
import { asCardError, CardError, type ErrorCode } from './errors.ts';
import { openRenderSession, type RenderOptions } from './preview/render.ts';

type BatchResult = {
  input: string;
  renderer: 'simulator' | 'client';
  platform: 'pc' | 'ios';
  output: string;
  status: 'pending' | 'ok' | 'error';
  warnings: unknown[];
  error?: { code: ErrorCode; message: string };
};

export async function renderBatch(inputs: string[], directory: string, options: RenderOptions) {
  await mkdir(directory, { recursive: true });
  const manifestPath = join(directory, 'manifest.json');
  const temporary = join(directory, `.manifest-${randomUUID()}.tmp`);
  const results: BatchResult[] = inputs.flatMap((input, index) => (['pc', 'ios'] as const).map(platform => ({
    input, renderer: options.renderer ?? 'simulator', platform,
    output: join(directory, `${String(index + 1).padStart(4, '0')}-${platform}.png`),
    status: 'pending', warnings: [],
  })));
  const manifest = { results };
  // 'create' fails if a manifest already exists; 'replace' swaps in a new snapshot atomically.
  async function writeManifest(mode: 'create' | 'replace') {
    await writeFile(temporary, JSON.stringify(manifest) + '\n', { flag: 'wx' });
    try {
      if (mode === 'create') await link(temporary, manifestPath);
      else await rename(temporary, manifestPath);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  try { await writeManifest('create'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new CardError('batch_output_exists', `Batch manifest already exists: ${manifestPath}`);
    throw error;
  }
  const session = await openRenderSession(options);
  const parsed = new Map<string, Promise<CardProject>>();
  try {
    for (const result of results) {
      try {
        if (!parsed.has(result.input)) parsed.set(result.input, readFile(result.input, 'utf8').then(text => ({ card: parseCard(text) })));
        const preview = await session.render(await parsed.get(result.input)!, result.platform);
        result.warnings = [...preview.compiled.warnings, ...preview.warnings];
        await writeFile(result.output, preview.png, { flag: 'wx' });
        result.status = 'ok';
      } catch (error) {
        const failure = asCardError(error, 'render_failed');
        result.status = 'error';
        result.error = { code: failure.code, message: failure.message };
      }
      await writeManifest('replace');
    }
  } finally {
    await session.close();
  }
  return manifest;
}
