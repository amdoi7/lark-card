import { expect, test } from 'bun:test';
import { asCardError, CardError, httpStatus } from '../../src/errors.ts';
import * as api from '../../src/index.ts';

test('error boundary adapter keeps known codes and reports everything else under the fallback', () => {
  expect(
    asCardError({ code: 'card_compile_failed', message: 'm', details: [1] }, 'render_failed'),
  ).toMatchObject({ code: 'card_compile_failed', message: 'm', details: [1] });
  expect(asCardError({ code: 'ENOENT', message: 'missing' }, 'render_failed')).toMatchObject({
    code: 'render_failed',
    message: 'missing',
  });
  expect(asCardError(new Error('boom'), 'compiler_runtime_failed')).toMatchObject({
    code: 'compiler_runtime_failed',
    message: 'boom',
  });
  const original = new CardError('usage_invalid', 'x');
  expect(asCardError(original, 'render_failed')).toBe(original);
  expect([
    httpStatus('usage_invalid'),
    httpStatus('batch_output_exists'),
    httpStatus('request_too_large'),
    httpStatus('compiler_timeout'),
  ]).toEqual([400, 409, 413, 500]);
});

test('the public API exports CardError so callers can branch on code', () => {
  expect(api.CardError).toBe(CardError);
  expect(Object.keys(api).sort()).toEqual(['CardError', 'compile', 'migrate', 'render']);
});
