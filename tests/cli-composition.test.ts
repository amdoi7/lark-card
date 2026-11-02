import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

async function invoke(args: string[], input: string) {
  const child = Bun.spawn(['bun', cli, ...args], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  child.stdin.write(input);
  child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

test('migrated Card JSON can be piped into compile', async () => {
  const input = JSON.stringify({
    config: { update_multi: true },
    elements: [{ tag: 'markdown', content: 'Piped card' }],
  });
  const migrated = await invoke(['migrate', '-'], input);
  expect(migrated.code).toBe(0);
  expect(JSON.parse(migrated.stdout).schema).toBe('2.0');
  expect(migrated.stderr).toContain('interaction_lifetime_changed');
  const compiled = await invoke(['compile', '-'], migrated.stdout);
  expect(compiled.code).toBe(0);
  expect(compiled.stderr).toBe('');
  expect(JSON.parse(compiled.stdout).sourceSchema).toBe('2.0');
  expect(JSON.stringify(JSON.parse(compiled.stdout).card)).toContain('Piped card');
}, 60000);

test('stdin invalid JSON fails without emitting output', async () => {
  const result = await invoke(['compile', '-'], '{');
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(JSON.parse(result.stderr).code).toBe('card_json_invalid');
});
