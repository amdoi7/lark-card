import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCard } from './card-input';
import { render, type PreviewOptions } from './core';

type BatchResult = {
  input: string;
  renderer: 'simulator' | 'client';
  platform: 'pc' | 'ios';
  output: string;
  status: 'pending' | 'ok' | 'error';
  warnings: unknown[];
  error?: { code: string; message: string };
};

export async function renderBatch(inputs: string[], directory: string, options: PreviewOptions) {
  await mkdir(directory, { recursive: true });
  const manifestPath = join(directory, 'manifest.json');
  const temporary = join(directory, `.manifest-${randomUUID()}.tmp`);
  const results: BatchResult[] = inputs.flatMap((input, index) => (['pc', 'ios'] as const).map(platform => ({
    input, renderer: options.renderer ?? 'simulator', platform,
    output: join(directory, `${String(index + 1).padStart(4, '0')}-${platform}.png`),
    status: 'pending', warnings: [],
  })));
  const manifest = { results };
  async function save(initial = false) {
    await writeFile(temporary, JSON.stringify(manifest) + '\n', { flag: 'wx' });
    try {
      if (initial) await link(temporary, manifestPath);
      else await rename(temporary, manifestPath);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  try { await save(true); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Object.assign(Error(`Batch manifest already exists: ${manifestPath}`), { code: 'batch_output_exists' });
    throw error;
  }
  for (const result of results) {
    try {
      const card = parseCard(await readFile(result.input, 'utf8'));
      const preview = await render({ card }, { ...options, platform: result.platform });
      result.warnings = [...preview.compiled.warnings, ...preview.warnings];
      await writeFile(result.output, preview.png, { flag: 'wx' });
      result.status = 'ok';
    } catch (error) {
      const failure = error as Error & { code?: string };
      result.status = 'error';
      result.error = { code: failure.code ?? 'render_failed', message: failure.message };
    }
    await save();
  }
  return manifest;
}
