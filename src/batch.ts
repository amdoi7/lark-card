import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCard } from './card-input';
import { render, type PreviewOptions } from './core';

type BatchResult = {
  input: string;
  renderer: 'simulator' | 'client';
  platform: 'pc' | 'ios';
  output: string;
  status: 'ok' | 'error';
  warnings: unknown[];
  error?: { code: string; message: string };
};

export async function renderBatch(inputs: string[], directory: string, options: PreviewOptions) {
  await mkdir(directory, { recursive: true });
  const manifestPath = join(directory, 'manifest.json');
  let manifestFile;
  try { manifestFile = await open(manifestPath, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Object.assign(Error(`Batch manifest already exists: ${manifestPath}`), { code: 'batch_output_exists' });
    throw error;
  }
  const results: BatchResult[] = [];
  try {
    for (const [index, input] of inputs.entries()) {
      for (const platform of ['pc', 'ios'] as const) {
        const output = join(directory, `${String(index + 1).padStart(4, '0')}-${platform}.png`);
        const result: BatchResult = { input, renderer: options.renderer ?? 'simulator', platform, output, status: 'ok', warnings: [] };
        try {
          const card = parseCard(await readFile(input, 'utf8'));
          const preview = await render({ card }, { ...options, platform });
          result.warnings = [...preview.compiled.warnings, ...preview.warnings];
          await writeFile(output, preview.png, { flag: 'wx' });
        } catch (error) {
          const failure = error as Error & { code?: string };
          result.status = 'error';
          result.error = { code: failure.code ?? 'render_failed', message: failure.message };
        }
        results.push(result);
      }
    }
    const manifest = { results };
    await manifestFile.writeFile(JSON.stringify(manifest) + '\n');
    return manifest;
  } finally {
    await manifestFile.close();
  }
}
