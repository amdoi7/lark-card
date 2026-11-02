import { chromium } from 'playwright-core';
import { CardError } from '../../src/core/errors.ts';
import { openRenderSession } from '../../src/engine/preview/session.ts';

const scenario = process.argv[2];
const signals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const before = signals.map((signal) => process.listenerCount(signal));
let browserCloses = 0,
  pageCloses = 0,
  pagesOpened = 0;
const launch = chromium.launch.bind(chromium);
chromium.launch = async (options) => {
  if (scenario === 'startup-interruption') {
    console.log(JSON.stringify({ stage: 'browser.launch' }));
    return new Promise<never>(() => {});
  }
  if (scenario === 'launch-failure') throw Error('Browser launch failed.');
  const browser = await launch(options);
  const newContext = browser.newContext.bind(browser);
  const closeBrowser = browser.close.bind(browser);
  browser.newContext = async (options) => {
    if (scenario === 'context-failure') throw Error('Context creation failed.');
    const context = await newContext(options);
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      pagesOpened++;
      if (scenario === 'page-failure') throw Error('Page creation failed.');
      const page = await newPage();
      const closePage = page.close.bind(page);
      page.close = async (options) => {
        pageCloses++;
        await closePage(options);
      };
      page.goto = async () => {
        throw Error('Navigation failed.');
      };
      return page;
    };
    return context;
  };
  browser.close = async (options) => {
    browserCloses++;
    await closeBrowser(options);
    if (scenario === 'close-failure') throw Error('Browser close failed.');
  };
  return browser;
};

let failure: { code?: string; message: string } | undefined;
try {
  const session = await openRenderSession({ chrome: process.env.LARK_CARD_CHROME });
  try {
    if (scenario === 'closed-render') {
      await Promise.all([session.close(), session.close()]);
      await session.render({ card: { schema: '2.0', body: { elements: [] } } }, 'pc');
    } else if (scenario === 'page-failure' || scenario === 'navigation-failure') {
      await session.render({ card: { schema: '2.0', body: { elements: [] } } }, 'pc');
    }
  } finally {
    await session.close();
  }
} catch (error) {
  if (error instanceof CardError) failure = { code: error.code, message: error.message };
  else if (error instanceof Error) failure = { message: error.message };
  else throw error;
}
console.log(
  JSON.stringify({
    failure,
    browserCloses,
    pageCloses,
    pagesOpened,
    listenerDeltas: signals.map((signal, index) => process.listenerCount(signal) - before[index]),
  }),
);
