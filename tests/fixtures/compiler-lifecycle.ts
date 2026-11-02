import { mock } from 'bun:test';
import * as threads from 'node:worker_threads';
import { CardError } from '../../src/core/errors.ts';

const scenario = process.argv[2];
const original = { ...threads };
const NativeWorker = threads.Worker;
let starts = 0;
let terminations = 0;
class ObservedWorker extends NativeWorker {
  constructor(filename: string | URL, options: threads.WorkerOptions = {}) {
    starts++;
    const injectFault = starts === 1 && (scenario === 'crash' || scenario === 'timeout');
    super(injectFault ? new URL('./compiler-failure-worker.ts', import.meta.url) : filename, {
      ...options,
      env: { ...process.env, LARK_CARD_TEST_FAULT: scenario },
    });
  }
  override async terminate() {
    terminations++;
    return super.terminate();
  }
}
mock.module('node:worker_threads', () => ({ ...original, Worker: ObservedWorker }));
const { compile } = await import('../../src/index.ts');
const project = {
  card: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: 'Recovered compiler' }] } },
};
async function failure(result: ReturnType<typeof compile>) {
  try {
    await result;
    return 'unexpected_success';
  } catch (error) {
    if (!(error instanceof CardError)) throw error;
    return error.code;
  }
}

if (scenario === 'reuse') {
  await compile(project);
  const invalid = await failure(
    compile({ card: { schema: '2.0', body: { elements: [{ tag: 'not_a_component' }] } } }),
  );
  const values = ['Unique-first', 'Unique-second', 'Unique-third', 'Unique-fourth'];
  const results = await Promise.all(
    values.map((value) =>
      compile(
        {
          card: {
            schema: '2.0',
            body: { elements: [{ tag: 'markdown', content: '${greeting}' }] },
          },
          variables: [{ name: 'greeting', type: 'text', mockData: value }],
        },
        'en_us',
      ),
    ),
  );
  console.log(
    JSON.stringify({
      starts,
      terminations,
      invalid,
      matches: results.map((result, index) => ({
        locale: result.locale,
        own: JSON.stringify(result.card).includes(values[index]),
        other: values.some(
          (value, other) => other !== index && JSON.stringify(result.card).includes(value),
        ),
      })),
    }),
  );
} else {
  const code = await failure(compile(project));
  const startsAfterFailure = starts;
  const recovered = await compile(project);
  console.log(
    JSON.stringify({
      starts,
      terminations,
      startsAfterFailure,
      code,
      recovered: JSON.stringify(recovered.card).includes('Recovered compiler'),
    }),
  );
}
