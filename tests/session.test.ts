import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { openRenderSession } from '../src/engine/preview/session.ts';

const fixture = fileURLToPath(new URL('./fixtures/session-lifecycle.ts', import.meta.url));

const cases: [string, string, number, number, number][] = [
  ['launch-failure', 'Browser launch failed.', 0, 0, 0],
  ['context-failure', 'Context creation failed.', 1, 0, 0],
  ['page-failure', 'Page creation failed.', 1, 1, 0],
  ['navigation-failure', 'Navigation failed.', 1, 1, 1],
  ['close-failure', 'Browser close failed.', 1, 0, 0],
  ['closed-render', 'The render session is closed.', 1, 0, 0],
];

test.each(cases)(
  'session %s reports a stable error and releases all owned resources',
  async (scenario, message, browserCloses, pagesOpened, pageCloses) => {
    // Arrange
    const child = Bun.spawn(['bun', fixture, scenario], {
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
      expect({ scenario, signal: child.signalCode }).toEqual({ scenario, signal: null });
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
      expect(JSON.parse(stdout)).toEqual({
        failure: { code: 'render_failed', message },
        browserCloses,
        pagesOpened,
        pageCloses,
        listenerDeltas: [0, 0, 0],
      });
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await child.exited;
    }
  },
  60000,
);

test('a failed card does not poison the next render in the same session', async () => {
  // Arrange
  await using session = await openRenderSession({ chrome: process.env.LARK_CARD_CHROME });
  await expect(
    session.render(
      { card: { schema: '2.0', body: { elements: [{ tag: 'not_a_component' }] } } },
      'pc',
    ),
  ).rejects.toMatchObject({ code: 'card_compile_failed' });

  // Act
  const result = await session.render(
    {
      card: {
        schema: '2.0',
        body: { elements: [{ tag: 'markdown', content: 'Recovered session' }] },
      },
    },
    'pc',
  );

  // Assert
  expect(result.png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(JSON.stringify(result.compiled.card)).toContain('Recovered session');
  expect(result.warnings).toEqual([]);
}, 120000);

test.skipIf(process.platform === 'win32')(
  'session startup handles SIGTERM while Chromium launch is pending',
  async () => {
    // Arrange
    const child = Bun.spawn(['bun', fixture, 'startup-interruption'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15000,
      killSignal: 'SIGKILL',
    });
    const reader = child.stdout.getReader();
    try {
      let output = '';
      const decoder = new TextDecoder();
      while (!output.includes('\n')) {
        const chunk = await reader.read();
        if (chunk.done) throw Error('The session exited before reaching browser launch.');
        output += decoder.decode(chunk.value, { stream: true });
      }
      expect(JSON.parse(output.trim())).toEqual({ stage: 'browser.launch' });

      // Act
      child.kill('SIGTERM');
      const exitCode = await child.exited;

      // Assert
      expect({ exitCode, signal: child.signalCode }).toEqual({ exitCode: 143, signal: null });
      expect(await new Response(child.stderr).text()).toBe('');
    } finally {
      reader.releaseLock();
      if (child.exitCode === null) child.kill('SIGKILL');
      await child.exited;
    }
  },
  60000,
);
