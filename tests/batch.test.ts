import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('batch renders both layouts and records failed inputs without overwriting files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-batch-'));
  try {
    const input = join(dir, 'card.json'),
      invalid = join(dir, 'invalid.json'),
      output = join(dir, 'output');
    await writeFile(
      input,
      JSON.stringify({
        schema: '2.0',
        body: {
          elements: [
            { tag: 'markdown', content: 'Batch card' },
            {
              tag: 'img',
              img_key: 'img_v2_nonexistent',
              alt: { tag: 'plain_text', content: 'Missing image' },
            },
          ],
        },
      }),
    );
    await writeFile(invalid, '{');
    const args = ['bun', cli, 'render-batch', input, invalid, '--output-dir', output];
    if (process.env.LARK_CARD_CHROME) args.push('--chrome', process.env.LARK_CARD_CHROME);
    const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toBe('');
    const manifest = JSON.parse(stdout) as {
      results: {
        input: string;
        platform: string;
        output: string;
        status: string;
        warnings: unknown[];
        error?: { code: string };
      }[];
    };
    expect(manifest.results.map((item) => [item.input, item.platform, item.status])).toEqual([
      [input, 'pc', 'ok'],
      [input, 'ios', 'ok'],
      [invalid, 'pc', 'error'],
      [invalid, 'ios', 'error'],
    ]);
    expect(manifest.results[2].error?.code).toBe('card_json_invalid');
    for (const item of manifest.results.slice(0, 2)) {
      expect((await readFile(item.output)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(item.warnings).toContainEqual({ code: 'resource_unresolved', resources: ['images'] });
    }
    expect(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))).toEqual(manifest);
    const again = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
    const [againOut, againErr, againCode] = await Promise.all([
      new Response(again.stdout).text(),
      new Response(again.stderr).text(),
      again.exited,
    ]);
    expect(againCode).not.toBe(0);
    expect(againOut).toBe('');
    expect(JSON.parse(againErr).code).toBe('batch_output_exists');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);

test('batch renders both layouts with the client renderer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-client-batch-'));
  try {
    const input = join(dir, 'card.json'),
      output = join(dir, 'output');
    await writeFile(
      input,
      JSON.stringify({
        schema: '2.0',
        body: { elements: [{ tag: 'markdown', content: 'Batch card' }] },
      }),
    );
    const args = [
      'bun',
      cli,
      'render-batch',
      input,
      '--renderer',
      'client',
      '--output-dir',
      output,
    ];
    if (process.env.LARK_CARD_CHROME) args.push('--chrome', process.env.LARK_CARD_CHROME);
    const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    const manifest = JSON.parse(stdout) as {
      results: { renderer: string; platform: string; status: string; output: string }[];
    };
    expect(manifest.results.map((item) => [item.renderer, item.platform, item.status])).toEqual([
      ['client', 'pc', 'ok'],
      ['client', 'ios', 'ok'],
    ]);
    for (const item of manifest.results)
      expect((await readFile(item.output)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);
