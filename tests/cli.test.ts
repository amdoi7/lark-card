import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));
const browserArgs = process.env.LARK_CARD_CHROME ? ['--chrome', process.env.LARK_CARD_CHROME] : [];
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const card = {
  schema: '2.0',
  header: { title: { tag: 'plain_text', content: 'Hello Lark' }, template: 'blue' },
  body: { elements: [{ tag: 'markdown', content: 'Preview from JSON' }] },
};

test('the package bin prints help without prepared assets or a browser', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'lark-card-help-'));
  await using resources = new AsyncDisposableStack();
  resources.defer(() => rm(directory, { recursive: true, force: true }));
  const root = new URL('../', import.meta.url);
  const manifest = await Bun.file(new URL('package.json', root)).json();
  const entry = fileURLToPath(new URL(manifest.bin['lark-card'], root));
  const child = Bun.spawn(['bun', entry, '--help'], {
    env: { ...process.env, LARK_CARD_CACHE: directory },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 15000,
    killSignal: 'SIGKILL',
  });
  try {
    // Act
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    // Assert
    expect(child.signalCode).toBeNull();
    expect({ stderr, exitCode }).toEqual({ stderr: '', exitCode: 0 });
    expect(stdout).toContain('lark-card <command>');
    expect(stdout).toContain('render-batch <files...>');
    expect(stdout).toContain('Compile and batch warnings are in stdout JSON');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await child.exited;
  }
});

test('compile writes a machine-readable CardKit result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-test-'));
  try {
    const input = join(dir, 'card.json');
    await writeFile(input, JSON.stringify(card));
    const process = Bun.spawn(['bun', cli, 'compile', input, '--locale', 'en_us'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    const result = JSON.parse(stdout);
    expect(result.sourceSchema).toBe('2.0');
    expect(result.locale).toBe('en_us');
    expect(result.card.schema).toBe('2.0');
    expect(JSON.stringify(result.card)).toContain('Preview from JSON');
    const invalid = Bun.spawn(['bun', cli, 'compile', input, '--platform', 'ios'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [invalidOut, invalidErr, invalidCode] = await Promise.all([
      new Response(invalid.stdout).text(),
      new Response(invalid.stderr).text(),
      invalid.exited,
    ]);
    expect(invalidCode).not.toBe(0);
    expect(invalidOut).toBe('');
    expect(JSON.parse(invalidErr).message).toContain('Option --platform is not valid for compile');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);

test('render accepts card JSON and writes a PNG to stdout or a file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-test-'));
  try {
    const input = join(dir, 'card.json');
    const output = join(dir, 'card.png');
    await writeFile(input, JSON.stringify(card));
    const stdout = Bun.spawn(['bun', cli, 'render', input, ...browserArgs], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [png, error, code] = await Promise.all([
      new Response(stdout.stdout).arrayBuffer(),
      new Response(stdout.stderr).text(),
      stdout.exited,
    ]);
    expect({ code, error }).toEqual({ code: 0, error: '' });
    const desktopPng = Buffer.from(png);
    expect(desktopPng.subarray(0, 8)).toEqual(signature);
    expect(desktopPng.readUInt32BE(16)).toBe(600);
    expect(desktopPng.readUInt32BE(20)).toBeGreaterThan(0);
    const file = Bun.spawn(
      [
        'bun',
        cli,
        'render',
        input,
        '--output',
        output,
        '--platform',
        'ios',
        '--theme',
        'dark',
        ...browserArgs,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [fileStdout, fileError, fileCode] = await Promise.all([
      new Response(file.stdout).text(),
      new Response(file.stderr).text(),
      file.exited,
    ]);
    expect({ code: fileCode, stdout: fileStdout, error: fileError }).toEqual({
      code: 0,
      stdout: '',
      error: '',
    });
    const darkPng = await readFile(output);
    expect(darkPng.subarray(0, 8)).toEqual(signature);
    expect(darkPng.readUInt32BE(16)).toBeLessThan(desktopPng.readUInt32BE(16));
    expect(darkPng.equals(desktopPng)).toBe(false);
    await writeFile(
      input,
      JSON.stringify({
        ...card,
        header: { ...card.header, title: { tag: 'plain_text', content: 'Customized title' } },
      }),
    );
    const customized = Bun.spawn(['bun', cli, 'render', input, ...browserArgs], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [customPng, customError, customCode] = await Promise.all([
      new Response(customized.stdout).arrayBuffer(),
      new Response(customized.stderr).text(),
      customized.exited,
    ]);
    expect({ code: customCode, error: customError }).toEqual({ code: 0, error: '' });
    expect(Buffer.from(customPng).subarray(0, 8)).toEqual(signature);
    expect(Buffer.from(customPng).equals(desktopPng)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);

// Regression: missing image resources previously produced a PNG without a warning.
test('render reports unresolved image resources on stderr', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-warning-'));
  try {
    const input = join(dir, 'card.json');
    await writeFile(
      input,
      JSON.stringify({
        schema: '2.0',
        body: {
          elements: [
            { tag: 'markdown', content: 'Image below' },
            {
              tag: 'img',
              img_key: 'img_v2_nonexistent',
              alt: { tag: 'plain_text', content: 'Missing image' },
            },
          ],
        },
      }),
    );
    const child = Bun.spawn(['bun', cli, 'render', input, ...browserArgs], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [png, stderr, code] = await Promise.all([
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(Buffer.from(png).subarray(0, 8)).toEqual(signature);
    expect(JSON.parse(stderr).warnings).toContainEqual({
      code: 'resource_unresolved',
      resources: ['images'],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);

test('render refuses to overwrite an input file, including through a hard link', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-test-'));
  try {
    const input = join(dir, 'card.json'),
      alias = join(dir, 'alias.png'),
      variables = join(dir, 'variables.json');
    const original = JSON.stringify(card);
    await writeFile(input, original);
    const { link } = await import('node:fs/promises');
    await link(input, alias);
    await writeFile(variables, '[]');
    for (const output of [input, alias, variables]) {
      const child = Bun.spawn(
        ['bun', cli, 'render', input, '--variables', variables, '-o', output],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).not.toBe(0);
      expect(stdout).toBe('');
      expect(JSON.parse(stderr).code).toBe('usage_invalid');
      expect(await readFile(input, 'utf8')).toBe(original);
      expect(await readFile(variables, 'utf8')).toBe('[]');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('render rejects an unknown component without emitting a PNG', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-test-'));
  try {
    const input = join(dir, 'invalid-component.json');
    await writeFile(
      input,
      JSON.stringify({ schema: '2.0', body: { elements: [{ tag: 'not_a_component' }] } }),
    );
    const process = Bun.spawn(['bun', cli, 'render', input, ...browserArgs], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(code).not.toBe(0);
    expect(stdout.byteLength).toBe(0);
    expect(JSON.parse(stderr).code).toBe('card_compile_failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);

test('render reports a missing Chrome binary without hanging', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-test-'));
  try {
    const input = join(dir, 'card.json');
    await writeFile(input, JSON.stringify(card));
    const process = Bun.spawn(
      ['bun', cli, 'render', input, '--chrome', join(dir, 'missing-chrome')],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(code).not.toBe(0);
    expect(stdout.byteLength).toBe(0);
    const failure = JSON.parse(stderr);
    expect(failure.code).toBe('render_failed');
    expect(failure.message).toContain(join(dir, 'missing-chrome'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);

test('render rejects malformed JSON without emitting a PNG', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lark-card-test-'));
  try {
    const input = join(dir, 'invalid.json');
    await writeFile(input, '{');
    const process = Bun.spawn(['bun', cli, 'render', input], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(code).not.toBe(0);
    expect(stdout.byteLength).toBe(0);
    expect(JSON.parse(stderr).code).toBe('card_json_invalid');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
