import { expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceCache = process.env.LARK_CARD_CACHE || join(homedir(), '.cache', 'lark-card');

test('asset setup prepares a private cache and rejects corrupted assets', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'lark-card-setup-'));
  const runSetup = async () => {
    const process = Bun.spawn(['bun', 'run', 'setup-assets'], {
      cwd: root,
      env: { ...globalThis.process.env, LARK_CARD_CACHE: cache },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
    ]);
    return { stdout, stderr, code };
  };
  try {
    await cp(sourceCache, cache, { recursive: true });
    const prepared = await runSetup();
    expect(prepared.code).toBe(0);
    expect(prepared.stdout).toContain('"operation":"compiler.prepared"');
    expect(prepared.stdout).toContain('"operation":"editor.prepared"');
    const generated = JSON.parse(await readFile(join(cache, 'editor', 'generated.json'), 'utf8')) as Record<string, string>;
    expect(generated['registry.mjs']).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(join(cache, 'cardkit-parser.wasm'), 'corrupted');
    const rejected = await runSetup();
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain('asset_integrity_mismatch');
    await cp(join(sourceCache, 'cardkit-parser.wasm'), join(cache, 'cardkit-parser.wasm'));
    const assets = JSON.parse(await readFile(join(root, 'src', 'assets', 'editor-assets.json'), 'utf8')) as { file: string }[];
    await writeFile(join(cache, assets[0].file), 'corrupted');
    const editorRejected = await runSetup();
    expect(editorRejected.code).not.toBe(0);
    expect(editorRejected.stderr).toContain('editor_asset_integrity_mismatch');
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}, 120000);
