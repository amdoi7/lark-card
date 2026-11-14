import { parentPort } from 'node:worker_threads';

if (!parentPort) throw Error('This fixture must run in a worker.');
parentPort.on('message', () => {
  if (process.env.LARK_CARD_TEST_FAULT === 'crash') process.exit(42);
});
