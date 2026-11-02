import { expect, test } from 'bun:test';
import { compile, migrate, render } from '../src/index.ts';

test('compiles a project without changing the source and resolves its variables', async () => {
  const project = {
    card: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: '${greeting}' }] } },
    variables: [{ name: 'greeting', type: 'text', mockData: 'Hello agent' }],
  };
  const original = structuredClone(project);
  const compiled = await compile(project, 'en_us');
  expect(compiled.sourceSchema).toBe('2.0');
  expect(compiled.locale).toBe('en_us');
  expect(JSON.stringify(compiled.card)).toContain('Hello agent');
  expect(project).toEqual(original);
});

test('renders a simulator PNG with the compiled snapshot', async () => {
  const project = {
    card: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: 'Hello preview' }] } },
  };
  const result = await render(project, { chrome: process.env.LARK_CARD_CHROME });
  expect(result.renderer).toBe('simulator');
  expect(result.png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(result.compiled.sourceSchema).toBe('2.0');
  expect(JSON.stringify(result.compiled.card)).toContain('Hello preview');
  expect(result.warnings).toEqual([]);
}, 120000);

test('simulator ignores component-like tags inside opaque action values', async () => {
  const project = {
    card: {
      schema: '2.0',
      body: {
        elements: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: 'Confirm' },
            value: { tag: 'not_a_component', nested: { tag: 'also_not_a_component' } },
          },
        ],
      },
    },
  };
  const result = await render(project, { chrome: process.env.LARK_CARD_CHROME });
  expect(
    result.warnings.some(
      (warning) =>
        warning.code === 'simulator_component_count_decreased' &&
        (warning.tag === 'not_a_component' || warning.tag === 'also_not_a_component'),
    ),
  ).toBe(false);
}, 120000);

test('simulator reports the path of a component dropped by editor conversion', async () => {
  const project = {
    card: {
      schema: '2.0',
      body: {
        elements: [
          { tag: 'markdown', content: 'Before panel' },
          {
            tag: 'collapsible_panel',
            expanded: false,
            header: { title: { tag: 'markdown', content: 'Details' } },
            elements: [{ tag: 'markdown', content: 'Hidden content' }],
          },
        ],
      },
    },
  };
  const result = await render(project, { chrome: process.env.LARK_CARD_CHROME });
  expect(result.warnings).toContainEqual({
    code: 'simulator_component_count_decreased',
    tag: 'collapsible_panel',
    inputCount: 1,
    exportedCount: 0,
    candidatePaths: ['card.body.elements[1]'],
  });
}, 120000);

const cardWithUnresolvedImage = {
  card: {
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
  },
};

// Regression: local renderers can produce PNGs while image resources are unavailable.
test('simulator warns when image resources cannot be resolved', async () => {
  const result = await render(cardWithUnresolvedImage, { chrome: process.env.LARK_CARD_CHROME });
  expect(result.warnings).toContainEqual({ code: 'resource_unresolved', resources: ['images'] });
  expect(
    result.warnings.some(
      (warning) =>
        warning.code === 'renderer_diagnostic' && warning.operation === 'host.unavailable',
    ),
  ).toBe(true);
}, 120000);

test('client warns when image resources cannot be resolved', async () => {
  const result = await render(cardWithUnresolvedImage, {
    renderer: 'client',
    chrome: process.env.LARK_CARD_CHROME,
  });
  expect(result.warnings).toContainEqual({ code: 'resource_unresolved', resources: ['images'] });
}, 120000);

test('migrates an independent V1 project only with sharing consent', async () => {
  const project = {
    card: {
      config: { update_multi: false },
      elements: [{ tag: 'markdown', content: 'Legacy card' }],
    },
    variables: [],
  };
  await expect(migrate(project)).rejects.toMatchObject({ code: 'migration_requires_shared' });
  const result = await migrate(project, { allowShared: true });
  expect(result.project.card.schema).toBe('2.0');
  expect(result.project.variables).toEqual([]);
  expect(result.compiled?.sourceSchema).toBe('2.0');
  expect(project.card.config.update_multi).toBe(false);
});
