import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, watch, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

// Regression: interruption previously left an empty manifest and partial PNGs.
test.skipIf(process.platform === 'win32')(
  'batch interruption leaves a readable manifest with pending cases',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lark-card-interrupt-'));
    const output = join(dir, 'output');
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const input = join(dir, 'card.json'),
        blocked = join(dir, 'blocked.json');
      await writeFile(
        input,
        JSON.stringify({
          schema: '2.0',
          body: { elements: [{ tag: 'markdown', content: 'First' }] },
        }),
      );
      const makeFifo = Bun.spawn(['mkfifo', blocked]);
      expect(await makeFifo.exited).toBe(0);
      const events = watch(dir, { recursive: true, signal: AbortSignal.timeout(30000) });
      const args = ['bun', cli, 'render-batch', input, blocked, '--output-dir', output];
      if (process.env.LARK_CARD_CHROME) args.push('--chrome', process.env.LARK_CARD_CHROME);
      child = Bun.spawn(args, { stdout: 'ignore', stderr: 'ignore' });
      let snapshot: { results: { status: string }[] } | undefined;
      for await (const _event of events) {
        try {
          const value = JSON.parse(
            await readFile(join(output, 'manifest.json'), 'utf8'),
          ) as typeof snapshot;
          if (value?.results.some((result) => result.status === 'ok')) {
            snapshot = value;
            break;
          }
        } catch (error) {
          if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error;
        }
      }
      child.kill('SIGTERM');
      await child.exited;
      child = undefined;
      const saved = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')) as {
        results: { status: string }[];
      };
      expect(snapshot!.results.some((result) => result.status === 'ok')).toBe(true);
      expect(saved.results.some((result) => result.status === 'pending')).toBe(true);
    } finally {
      if (child) {
        child.kill('SIGTERM');
        await child.exited;
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
  60000,
);
