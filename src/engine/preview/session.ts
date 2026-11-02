import { chromium } from 'playwright-core';
import { asCardError, CardError } from '../../core/errors.ts';
import type { CardProject } from '../../core/schema.ts';
import { renderPage, type RenderResult, type RenderSettings } from './render.ts';
import { startPreviewServer } from './server.ts';

export type RenderOptions = {
  locale?: string;
  platform?: 'pc' | 'ios';
  theme?: 'light' | 'dark';
  chrome?: string;
} & ({ renderer?: 'simulator'; webcontent?: never } | { renderer: 'client'; webcontent?: string });

export type RenderSession = AsyncDisposable & {
  render(project: CardProject, platform: 'pc' | 'ios'): Promise<RenderResult>;
  close(): Promise<void>;
};

/** A session reuses one browser context. Each render owns a fresh page; closing cancels active pages and rejects new renders. */
export async function openRenderSession(options: RenderOptions = {}): Promise<RenderSession> {
  try {
    await using startup = new AsyncDisposableStack();
    const renderer = options.renderer ?? 'simulator';
    const base: Omit<RenderSettings, 'platform'> = {
      renderer,
      locale: options.locale ?? 'zh_cn',
      theme: options.theme ?? 'light',
    };
    const server = await startPreviewServer({ port: 0, renderer, webcontent: options.webcontent });
    startup.defer(() => server.close());
    const signals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const exitOnSignal = (signal: NodeJS.Signals) =>
      process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
    for (const signal of signals) process.once(signal, exitOnSignal);
    startup.defer(() => {
      for (const signal of signals) process.off(signal, exitOnSignal);
    });
    // Playwright 1.64.1 graceful signal shutdown can hang during rendering. Its exit hook kills Chromium.
    const browser = await chromium.launch({
      headless: true,
      executablePath: options.chrome,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    startup.defer(() => browser.close());
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 1,
    });
    const lifetime = startup.move();
    let closing: Promise<void> | undefined;
    function close(): Promise<void> {
      return (closing ??= lifetime.disposeAsync().catch((error) => {
        throw asCardError(error, 'render_failed');
      }));
    }
    return {
      async render(project, platform) {
        try {
          if (closing) throw new CardError('render_failed', 'The render session is closed.');
          await using page = await context.newPage();
          return await renderPage(page, server.url, project, { ...base, platform });
        } catch (error) {
          throw asCardError(error, 'render_failed');
        }
      },
      close,
      [Symbol.asyncDispose]: close,
    };
  } catch (error) {
    throw asCardError(error, 'render_failed');
  }
}

export async function render(
  project: CardProject,
  options: RenderOptions = {},
): Promise<RenderResult> {
  try {
    await using session = await openRenderSession(options);
    return await session.render(project, options.platform ?? 'pc');
  } catch (error) {
    throw asCardError(error, 'render_failed');
  }
}
