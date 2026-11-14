import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreviewServer } from '../src/engine/preview/server.ts';

test('editor binds locally and rejects cross-origin compilation', async () => {
  const server = await startPreviewServer({ port: 0 });
  try {
    const page = await fetch(server.url + '/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('card-source');
    expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(server.url, { headers: { Host: 'evil.example' } }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    expect(hostStatus).toBe(403);
    expect((await fetch(server.url + '/vendor/other/file.js')).status).toBe(404);
    expect((await fetch(server.url + '/browser/editor-registry.d.ts')).status).toBe(404);
    const inspector = await fetch(server.url + '/browser/inspect-cardkit.ts');
    expect(inspector.status).toBe(200);
    expect(inspector.headers.get('content-type')).toContain('text/javascript');
    expect(await inspector.text()).toContain('simulator_host_missing');
    expect((await fetch(server.url, { method: 'POST' })).status).toBe(405);
    const response = await fetch(server.url + '/api/compile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.com' },
      body: JSON.stringify({ card: { schema: '2.0', body: { elements: [] } } }),
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('origin_not_allowed');
    const legacy = {
      config: { update_multi: true },
      elements: [{ tag: 'markdown', content: '**Legacy card**' }],
    };
    const migrate = await fetch(server.url + '/api/migrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url },
      body: JSON.stringify({ card: legacy }),
    });
    expect(migrate.status).toBe(200);
    const migrated = (await migrate.json()) as {
      card: { schema: string; body: { elements: { content: string }[] } };
    };
    expect(migrated.card.schema).toBe('2.0');
    expect(migrated.card.body.elements[0].content).toBe('**Legacy card**');
  } finally {
    await server.close();
  }
}, 30000);

test('bun serve starts the editor and stops on SIGTERM', async () => {
  const process = Bun.spawn(['bun', 'run', 'serve', '--port', '0'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reader = process.stdout.getReader();
    const line = await Promise.race([
      (async () => {
        let output = '';
        while (!output.includes('\n')) {
          const chunk = await reader.read();
          if (chunk.done) throw Error(`serve_exited code=${await process.exited}`);
          output += new TextDecoder().decode(chunk.value);
        }
        return output.split('\n')[0];
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('serve_ready_timeout')), 30000);
      }),
    ]);
    const ready = JSON.parse(line) as { operation: string; url: string };
    expect(ready.operation).toBe('preview.ready');
    expect((await fetch(ready.url)).status).toBe(200);
  } finally {
    clearTimeout(timer);
    process.kill('SIGTERM');
    await process.exited;
  }
}, 60000);

test('simulator starts without Lark client archives', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lark-card-no-client-'));
  try {
    const server = await startPreviewServer({
      port: 0,
      renderer: 'simulator',
      webcontent: directory,
    });
    try {
      expect((await fetch(server.url)).status).toBe(200);
      expect(
        (
          await fetch(server.url + '/api/compile', {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: server.url },
            body: JSON.stringify({
              card: {
                schema: '2.0',
                body: { elements: [{ tag: 'markdown', content: 'Local card' }] },
              },
            }),
          })
        ).status,
      ).toBe(200);
    } finally {
      await server.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('rejects a malformed Lark archive before listening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lark-card-invalid-asar-'));
  try {
    await writeFile(join(directory, 'messenger.asar'), Buffer.alloc(12));
    await expect(
      startPreviewServer({ port: 0, renderer: 'client', webcontent: directory }),
    ).rejects.toMatchObject({
      code: 'client_unavailable',
      message: expect.stringContaining('asar_header_invalid'),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('compiler preserves V1 and V2 schemas, localizes V1, and rejects failed components', async () => {
  const server = await startPreviewServer({ port: 0 });
  const compile = (card: unknown, locale = 'zh_cn') =>
    fetch(server.url + '/api/compile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url },
      body: JSON.stringify({ card, locale }),
    });
  try {
    const legacy = {
      i18n_header: { en_us: { title: { tag: 'plain_text', content: 'English title' } } },
      i18n_elements: { en_us: [{ tag: 'markdown', content: 'English body' }] },
    };
    const v1 = await compile(legacy, 'en_us');
    expect(v1.status).toBe(200);
    const legacyResult = (await v1.json()) as {
      sourceSchema: string;
      card: { schema: string; header: { property: { title: { property: { content: string } } } } };
    };
    expect(legacyResult.sourceSchema).toBe('1.0');
    expect(legacyResult.card.schema).toBe('1.0');
    expect(legacyResult.card.header.property.title.property.content).toBe('English title');
    const v2 = await compile({
      schema: '2.0',
      body: { elements: [{ tag: 'markdown', content: 'V2 body' }] },
    });
    expect(v2.status).toBe(200);
    const v2Result = (await v2.json()) as { sourceSchema: string; card: { schema: string } };
    expect(v2Result.sourceSchema).toBe('2.0');
    expect(v2Result.card.schema).toBe('2.0');
    const invalid = await compile({
      elements: [
        {
          tag: 'action',
          actions: [{ tag: 'button', text: { tag: 'plain_text', content: 'Click' } }],
        },
      ],
    });
    expect(invalid.status).toBe(400);
    const failure = (await invalid.json()) as {
      code: string;
      details: { tag: string; code: number }[];
    };
    expect(failure.code).toBe('card_component_failed');
    expect(failure.details[0].tag).toBe('action');
    expect(failure.details[0].code).toBe(200861);
  } finally {
    await server.close();
  }
}, 30000);

test('compiler preserves opaque chart data and resolves declared variables', async () => {
  const server = await startPreviewServer({ port: 0 });
  const compile = (card: unknown, variables: unknown[] = []) =>
    fetch(server.url + '/api/compile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url },
      body: JSON.stringify({ card, variables }),
    });
  try {
    const chart = {
      type: 'line',
      data: [
        {
          id: 'series',
          values: [
            {
              x: 'A',
              y: 1,
              tag: 'note',
              matrix: [
                [1, 2],
                [3, 4],
              ],
            },
          ],
        },
      ],
      xField: 'x',
      yField: 'y',
    };
    const chartResponse = await compile({ elements: [{ tag: 'chart', chart_spec: chart }] });
    expect(chartResponse.status).toBe(200);
    const chartResult = (await chartResponse.json()) as {
      card: { newBody: { property: { elements: { property: { chartSpec: unknown } }[] } } };
    };
    expect(chartResult.card.newBody.property.elements[0].property.chartSpec).toEqual(chart);
    const variableResponse = await compile(
      { schema: '2.0', body: { elements: [{ tag: 'markdown', content: '${greeting}' }] } },
      [{ name: 'greeting', type: 'text', mockData: 'Variable resolved' }],
    );
    expect(variableResponse.status).toBe(200);
    expect(JSON.stringify(await variableResponse.json())).toContain('Variable resolved');
    const invalidVariables = await fetch(server.url + '/api/compile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url },
      body: JSON.stringify({ card: { schema: '2.0', body: { elements: [] } }, variables: {} }),
    });
    expect(invalidVariables.status).toBe(400);
    expect(((await invalidVariables.json()) as { code: string }).code).toBe('card_json_invalid');
  } finally {
    await server.close();
  }
}, 30000);

test('migration preserves translations and requires consent for sharing changes', async () => {
  const server = await startPreviewServer({ port: 0 });
  const migrate = (card: unknown, allowShared = false) =>
    fetch(server.url + '/api/migrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url },
      body: JSON.stringify({ card, allowShared }),
    });
  try {
    const card = {
      config: { update_multi: true },
      i18n_header: {
        zh_cn: { title: { tag: 'plain_text', content: '中文标题' } },
        en_us: { title: { tag: 'plain_text', content: 'English title' } },
      },
      i18n_elements: {
        zh_cn: [{ tag: 'markdown', content: '中文正文' }],
        en_us: [{ tag: 'markdown', content: 'English body' }],
      },
    };
    const response = await migrate(card);
    expect(response.status).toBe(200);
    const migrated = (await response.json()) as {
      card: {
        header: { title: { i18n_content: unknown } };
        body: { elements: { i18n_content: unknown }[] };
      };
    };
    expect(migrated.card.header.title.i18n_content).toEqual({
      zh_cn: '中文标题',
      en_us: 'English title',
    });
    expect(migrated.card.body.elements[0].i18n_content).toEqual({
      zh_cn: '中文正文',
      en_us: 'English body',
    });
    const mismatch = await migrate({
      ...card,
      i18n_elements: { ...card.i18n_elements, en_us: [...card.i18n_elements.en_us, { tag: 'hr' }] },
    });
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { code: string }).code).toBe(
      'migration_locale_structure_mismatch',
    );
    const independent = {
      config: { update_multi: false },
      elements: [{ tag: 'markdown', content: 'Independent card' }],
    };
    const denied = await migrate(independent);
    expect(denied.status).toBe(400);
    expect(((await denied.json()) as { code: string }).code).toBe('migration_requires_shared');
    const allowed = await migrate(independent, true);
    expect(allowed.status).toBe(200);
    expect(
      ((await allowed.json()) as { card: { config: { update_multi: boolean } } }).card.config
        .update_multi,
    ).toBe(true);
    const payload = {
      fallback: 'business value',
      nested: { tag: 'note', elements: 'not a component' },
    };
    const action = await migrate({
      config: { update_multi: true },
      elements: [
        {
          tag: 'action',
          layout: 'bisected',
          actions: [
            {
              tag: 'button',
              name: 'confirm',
              text: { tag: 'plain_text', content: 'Confirm' },
              value: payload,
            },
          ],
        },
      ],
    });
    expect(action.status).toBe(200);
    const actionResult = (await action.json()) as {
      card: { body: { elements: { columns: { elements: { value: unknown }[] }[] }[] } };
    };
    expect(actionResult.card.body.elements[0].columns[0].elements[0].value).toEqual(payload);
    const unsupported = await migrate({
      config: { update_multi: true },
      elements: [
        {
          tag: 'markdown',
          content: '[link]($url)',
          href: { url: { url: 'https://example.invalid/' } },
        },
      ],
    });
    expect(unsupported.status).toBe(400);
    expect(((await unsupported.json()) as { code: string }).code).toBe('migration_requires_manual');
  } finally {
    await server.close();
  }
}, 30000);
