import { expect, test } from 'bun:test';
import { assertLocale } from '../../src/core/locales.ts';
import { parseCard } from '../../src/core/schema.ts';
import { toCompilerInput } from '../../src/core/input.ts';
import { CardError } from '../../src/core/errors.ts';

test('parses official V1 and V2 card objects without changing their content', () => {
  expect(parseCard('{"elements":[]}')).toEqual({ elements: [] });
  expect(parseCard('{"schema":"2.0","body":{"elements":[]}}')).toEqual({
    schema: '2.0',
    body: { elements: [] },
  });
});

test.each([
  ['malformed JSON', '{', 'Input must be valid JSON.'],
  ['null', 'null', 'Card JSON must be an object.'],
  ['array', '[]', 'Card JSON must be an object.'],
  ['string', '"card"', 'Card JSON must be an object.'],
  ['unsupported schema', '{"schema":"3.0"}', 'Unsupported card schema: 3.0.'],
])('rejects %s with a stable code and an English message', (_name, input, message) => {
  expect(() => parseCard(input)).toThrow(
    expect.objectContaining({ code: 'card_json_invalid', message }),
  );
  expect(() => parseCard(input)).toThrow(CardError);
});

test.each([
  ['locale map', { i18n_elements: [] }, 'i18n_elements must map locales to content.'],
  ['localized elements', { i18n_elements: { en_us: {} } }, 'i18n_elements.en_us must be an array.'],
  ['elements', { elements: {} }, 'Card elements must be an array.'],
])('rejects an invalid V1 %s before compilation', (_name, card, message) => {
  expect(() => toCompilerInput(card)).toThrow(
    expect.objectContaining({ code: 'card_json_invalid', message }),
  );
});

test('locale validation has one owner and one code', () => {
  expect(() => assertLocale('xx')).toThrow(expect.objectContaining({ code: 'locale_invalid' }));
  expect(() => toCompilerInput({ schema: '2.0' }, 'xx')).toThrow(
    expect.objectContaining({ code: 'locale_invalid' }),
  );
  expect(() => assertLocale('en_us')).not.toThrow();
});

test('toCompilerInput lowers a V1 card to the compiler shape and picks the requested locale', () => {
  const compilerInput = toCompilerInput(
    {
      i18n_elements: {
        zh_cn: [{ tag: 'markdown', content: '中文' }],
        en_us: [{ tag: 'markdown', content: 'English' }],
      },
      header: { title: { tag: 'plain_text', content: 'T' }, ud_icon: { token: 'bell_outlined' } },
    },
    'en_us',
  );
  expect(compilerInput.sourceSchema).toBe('1.0');
  expect(compilerInput.card.body).toEqual({ elements: [{ tag: 'markdown', content: 'English' }] });
  expect(compilerInput.card.header?.icon).toEqual({ tag: 'standard_icon', token: 'bell_outlined' });
  expect(compilerInput.warnings).toEqual([]);
  const fallback = toCompilerInput(
    { i18n_elements: { zh_cn: [], en_us: [{ tag: 'hr' }] } },
    'ja_jp',
  );
  expect(fallback.card.body).toEqual({ elements: [{ tag: 'hr' }] });
  expect(fallback.warnings).toEqual([
    { code: 'locale_fallback', path: 'card.i18n_elements', requested: 'ja_jp', selected: 'en_us' },
  ]);
});
