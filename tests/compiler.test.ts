import { expect, test } from 'bun:test';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheDirectory } from '../src/assets/cache.ts';
import { compile } from '../src/index.ts';

const fixture = fileURLToPath(new URL('./fixtures/compiler-lifecycle.ts', import.meta.url));
async function _run(scenario: string) {
  const child = Bun.spawn(['bun', fixture, scenario], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 45000,
    killSignal: 'SIGKILL',
  });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ scenario, signal: child.signalCode }).toEqual({ scenario, signal: null });
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
    return JSON.parse(stdout);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await child.exited;
  }
}

test('cards reuse one worker without leaking variables or retaining a previous card failure', async () => {
  // Arrange / Act
  const result = await _run('reuse');
  // Assert
  expect(result).toEqual({
    starts: 1,
    terminations: 0,
    invalid: 'card_compile_failed',
    matches: Array.from({ length: 4 }, () => ({ locale: 'en_us', own: true, other: false })),
  });
}, 60000);

const faults: [string, string][] = [
  ['crash', 'compiler_runtime_failed'],
  ['timeout', 'compiler_timeout'],
];
test.each(faults)(
  'a %s rejects its request without retrying and the next request uses a fresh worker',
  async (scenario, code) => {
    // Arrange / Act
    const result = await _run(scenario);
    // Assert
    expect(result).toEqual({
      starts: 2,
      terminations: 1,
      startsAfterFailure: 1,
      code,
      recovered: true,
    });
  },
  60000,
);

test('compilation snapshots the card and variables before waiting for the worker', async () => {
  // Arrange
  const project = {
    card: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: '${greeting}' }] } },
    variables: [{ name: 'greeting', type: 'text', mockData: 'Original value' }],
  };

  // Act
  const pending = compile(project);
  project.card.body.elements[0].content = 'Changed card';
  project.variables[0].mockData = 'Changed variable';
  const result = await pending;

  // Assert
  expect(JSON.stringify(result.card)).toContain('Original value');
  expect(JSON.stringify(result.card)).not.toContain('Changed');
});

test('compiler startup rejects invalid initialization data and exits without hanging', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'lark-card-compiler-'));
  try {
    await Promise.all(
      ['wasm_exec.js', 'cardkit-parser.wasm'].map((file) =>
        cp(join(cacheDirectory, file), join(directory, file)),
      ),
    );
    await writeFile(join(directory, 'compiler-init.json'), '[null,null,null]');
    const input = join(directory, 'card.json');
    await writeFile(input, JSON.stringify({ schema: '2.0', body: { elements: [] } }));
    const cli = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));

    // Act
    const child = Bun.spawn(['bun', cli, 'compile', input], {
      env: { ...process.env, LARK_CARD_CACHE: directory },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15000,
      killSignal: 'SIGKILL',
    });
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      // Assert
      expect(child.signalCode).toBeNull();
      expect({ stdout, exitCode }).toEqual({ stdout: '', exitCode: 1 });
      expect(JSON.parse(stderr)).toMatchObject({
        code: 'assets_unavailable',
        message: expect.stringContaining('bun run setup-assets'),
      });
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await child.exited;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
