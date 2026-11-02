import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));

// Regression: a missing cache surfaced as a raw ENOENT (render) or a module-resolution error (compile).
test('commands report assets_unavailable with the fix when the asset cache was never prepared', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-empty-cache-'));
  try {
    const input = join(dir, 'card.json');
    await writeFile(input, JSON.stringify({ schema: '2.0', body: { elements: [] } }));
    for (const command of ['compile', 'render']) {
      const child = Bun.spawn(['bun', cli, command, input], {
        env: { ...process.env, LARK_CARD_CACHE: join(dir, 'cache') },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ command, code, stdout }).toEqual({ command, code: 1, stdout: '' });
      expect(JSON.parse(stderr)).toMatchObject({
        code: 'assets_unavailable',
        message: expect.stringContaining('bun run setup-assets'),
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
