import { expect, test } from 'bun:test';
import { convertV1ToV2 } from '../../src/card/v1-to-v2.ts';

const rejects = (run: () => unknown, code: string) => expect(run).toThrow(expect.objectContaining({ code }));

test('V1 → V2 requires explicit consent to leave independent mode', () => {
  const card = { config: { update_multi: false }, elements: [{ tag: 'markdown', content: 'Independent card' }] };
  rejects(() => convertV1ToV2(card), 'migration_requires_shared');
  const migrated = convertV1ToV2(card, { allowShared: true });
  expect(migrated.card.schema).toBe('2.0');
  expect(migrated.card.config?.update_multi).toBe(true);
  expect(migrated.warnings.map(warning => warning.code)).toContain('sharing_changed');
  expect(card.config.update_multi).toBe(false);
});

test('only 1.0 cards can be migrated', () => {
  rejects(() => convertV1ToV2({ schema: '2.0', body: { elements: [] } }), 'migration_source_invalid');
});

test('per-locale V1 content merges into i18n_content and the requested locale is compiled first', () => {
  const card = {
    config: { update_multi: true },
    i18n_header: { zh_cn: { title: { tag: 'plain_text', content: '中文标题' } }, en_us: { title: { tag: 'plain_text', content: 'English title' } } },
    i18n_elements: { zh_cn: [{ tag: 'markdown', content: '中文正文' }], en_us: [{ tag: 'markdown', content: 'English body' }] },
  };
  const migrated = convertV1ToV2(card, { locale: 'en_us' });
  expect(migrated.chosen).toBe('en_us');
  expect([...migrated.locales].sort()).toEqual(['en_us', 'zh_cn']);
  const body = migrated.card.body as { elements: { i18n_content: unknown }[] };
  const header = migrated.card.header as { title: { i18n_content: unknown } };
  expect(header.title.i18n_content).toEqual({ en_us: 'English title', zh_cn: '中文标题' });
  expect(body.elements[0].i18n_content).toEqual({ en_us: 'English body', zh_cn: '中文正文' });
});

test('locales whose structure differs cannot be merged', () => {
  const card = {
    config: { update_multi: true },
    i18n_elements: { zh_cn: [{ tag: 'markdown', content: 'a' }], en_us: [{ tag: 'markdown', content: 'a' }, { tag: 'hr' }] },
  };
  rejects(() => convertV1ToV2(card), 'migration_locale_structure_mismatch');
});

test('action modules become column sets and keep button values untouched', () => {
  const payload = { fallback: 'business value', nested: { tag: 'note', elements: 'not a component' } };
  const migrated = convertV1ToV2({ config: { update_multi: true }, elements: [
    { tag: 'action', layout: 'bisected', actions: [{ tag: 'button', name: 'confirm', text: { tag: 'plain_text', content: 'Confirm' }, value: payload }] },
  ] });
  const [columnSet] = (migrated.card.body as { elements: { tag: string; flex_mode: string; columns: { elements: { value: unknown }[] }[] }[] }).elements;
  expect(columnSet.tag).toBe('column_set');
  expect(columnSet.flex_mode).toBe('bisect');
  expect(columnSet.columns[0].elements[0].value).toEqual(payload);
});

test('constructs that need a human decision are rejected, not guessed', () => {
  rejects(() => convertV1ToV2({ config: { update_multi: true }, elements: [
    { tag: 'markdown', content: '[link]($url)', href: { url: { url: 'https://example.invalid/' } } },
  ] }), 'migration_requires_manual');
  rejects(() => convertV1ToV2({ config: { update_multi: true }, elements: [{ tag: 'action', layout: 'diagonal', actions: [] }] }), 'migration_requires_manual');
});

test('an unsupported locale in the card is rejected', () => {
  rejects(() => convertV1ToV2({ config: { update_multi: true }, i18n_elements: { xx_yy: [] } }), 'locale_invalid');
});
