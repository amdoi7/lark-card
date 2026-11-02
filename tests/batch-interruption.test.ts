import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, watch, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));

const interruptions: [NodeJS.Signals, number][] = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
];

// Without atomic snapshots, interruption can leave an unreadable manifest and partial PNGs.
test.skipIf(process.platform === 'win32').each(interruptions)(
  'batch %s interruption leaves a readable manifest with pending cases (POSIX FIFO)',
  async (signal, expectedExit) => {
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
      child = Bun.spawn(args, {
        stdout: 'ignore',
        stderr: 'ignore',
        timeout: 45000,
        killSignal: 'SIGKILL',
      });
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
      child.kill(signal);
      const exitCode = await child.exited;
      expect({ exitCode, signal: child.signalCode }).toEqual({
        exitCode: expectedExit,
        signal: null,
      });
      child = undefined;
      const saved = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')) as {
        results: { status: string }[];
      };
      expect(snapshot!.results.some((result) => result.status === 'ok')).toBe(true);
      expect(saved.results.some((result) => result.status === 'pending')).toBe(true);
    } finally {
      if (child) {
        if (child.exitCode === null) child.kill('SIGKILL');
        await child.exited;
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
  60000,
);
