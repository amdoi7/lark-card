import { expect, test } from 'bun:test';
import { assertLocale, parseCard, toCompilerInput } from '../../src/card/input.ts';
import { CardError } from '../../src/errors.ts';

test('parses official V1 and V2 card objects without changing their content', () => {
  expect(parseCard('{"elements":[]}')).toEqual({ elements: [] });
  expect(parseCard('{"schema":"2.0","body":{"elements":[]}}')).toEqual({ schema: '2.0', body: { elements: [] } });
});

test('rejects malformed JSON, non-object values and unsupported schemas with card_json_invalid', () => {
  for (const input of ['{', 'null', '[]', '"card"', '{"schema":"3.0"}']) {
    expect(() => parseCard(input)).toThrow(expect.objectContaining({ code: 'card_json_invalid' }));
    expect(() => parseCard(input)).toThrow(CardError);
  }
});

test('locale validation has one owner and one code', () => {
  expect(() => assertLocale('xx')).toThrow(expect.objectContaining({ code: 'locale_invalid' }));
  expect(() => toCompilerInput({ schema: '2.0' }, 'xx')).toThrow(expect.objectContaining({ code: 'locale_invalid' }));
  expect(() => assertLocale('en_us')).not.toThrow();
});

test('toCompilerInput lowers a V1 card to the compiler shape and picks the requested locale', () => {
  const compilerInput = toCompilerInput({
    i18n_elements: { zh_cn: [{ tag: 'markdown', content: '中文' }], en_us: [{ tag: 'markdown', content: 'English' }] },
    header: { title: { tag: 'plain_text', content: 'T' }, ud_icon: { token: 'bell_outlined' } },
  }, 'en_us');
  expect(compilerInput.sourceSchema).toBe('1.0');
  expect(compilerInput.card.body).toEqual({ elements: [{ tag: 'markdown', content: 'English' }] });
  expect(compilerInput.card.header?.icon).toEqual({ tag: 'standard_icon', token: 'bell_outlined' });
  expect(compilerInput.warnings).toEqual([]);
  const fallback = toCompilerInput({ i18n_elements: { zh_cn: [], en_us: [{ tag: 'hr' }] } }, 'ja_jp');
  expect(fallback.card.body).toEqual({ elements: [{ tag: 'hr' }] });
  expect(fallback.warnings).toEqual([{ code: 'locale_fallback', path: 'card.i18n_elements', requested: 'ja_jp', selected: 'en_us' }]);
});
