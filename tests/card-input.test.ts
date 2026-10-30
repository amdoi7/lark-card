import { expect, test } from 'bun:test';
import { InputError, parseCard } from '../src/card-input';

test('parses official V1 and V2 card objects without changing their content', () => {
  expect(parseCard('{"elements":[]}')).toEqual({ elements: [] });
  expect(parseCard('{"schema":"2.0","body":{"elements":[]}}')).toEqual({ schema: '2.0', body: { elements: [] } });
});

test('rejects malformed JSON, non-object values and unsupported schemas', () => {
  for (const input of ['{', 'null', '[]', '"card"', '{"schema":"3.0"}']) {
    expect(() => parseCard(input)).toThrow(InputError);
  }
});
