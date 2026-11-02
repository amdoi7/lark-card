import type { Page } from 'playwright-core';
import type { CardProject } from '../../core/schema.ts';
import type { CompiledCard } from '../compiler/index.ts';
import { asCardError, CardError } from '../../core/errors.ts';
import {
  diagnosticWarnings,
  conversionWarnings,
  resourceWarnings,
  type Diagnostic,
  type RenderWarning,
} from './warnings.ts';

export type { RenderWarning } from './warnings.ts';

export type RenderResult = {
  png: Buffer;
  renderer: 'simulator' | 'client';
  compiled: CompiledCard;
  warnings: RenderWarning[];
};

type EditorApi = {
  load(card: unknown, variables: readonly unknown[], locale: string): Promise<CompiledCard>;
  exportProject(): { card: unknown };
  diagnostics: Diagnostic[];
};
type ClientApi = { render(card: unknown): Promise<CompiledCard>; diagnostics: Diagnostic[] };

async function withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Error(`render_timeout operation=${operation} limit_ms=30000`)),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function waitForBootstrap(page: Page, selector: string) {
  await page.waitForFunction((selector) => {
    const state = document.querySelector<HTMLElement>(selector)!.dataset.state;
    return state === 'ready' || state === 'error';
  }, selector);
  const status = await page.locator(selector).evaluate((element) => ({
    state: (element as HTMLElement).dataset.state,
    message: element.textContent,
  }));
  if (status.state !== 'ready')
    throw Error(`preview_bootstrap_failed message=${JSON.stringify(status.message)}`);
}

export type RenderSettings = {
  renderer: 'simulator' | 'client';
  locale: string;
  platform: 'pc' | 'ios';
  theme: 'light' | 'dark';
};

async function renderClient(
  page: Page,
  url: string,
  project: CardProject,
  { locale, platform, theme }: RenderSettings,
): Promise<RenderResult> {
  await page.goto(url + '/preview');
  await waitForBootstrap(page, '#status');
  const result = await withTimeout(
    page.evaluate(
      async (input) => {
        document.querySelector<HTMLTextAreaElement>('#variables')!.value = JSON.stringify(
          input.variables,
        );
        document.querySelector<HTMLSelectElement>('#platform')!.value = input.platform;
        document.querySelector<HTMLSelectElement>('#theme')!.value = input.theme;
        const localeControl = document.querySelector<HTMLSelectElement>('#locale')!;
        localeControl.value = input.locale;
        if (localeControl.value !== input.locale)
          throw Error('locale_invalid value=' + input.locale);
        try {
          const client = (window as unknown as { feishuPreview: ClientApi }).feishuPreview;
          const diagnosticStart = client.diagnostics.length;
          const compiled = await client.render(input.card);
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          return { compiled, diagnosticStart };
        } catch (error) {
          const failure = error as Error & { code?: string; details?: unknown };
          return {
            error: {
              code: failure.code ?? 'render_failed',
              message: failure.message,
              details: failure.details,
            },
          };
        }
      },
      { card: project.card, variables: project.variables ?? [], platform, theme, locale },
    ),
    'client',
  );
  if (result.error) throw asCardError(result.error, 'render_failed');
  const png = await page.locator('#preview-card').screenshot({ type: 'png' });
  const diagnostics = await page.evaluate(
    (start) =>
      (window as unknown as { feishuPreview: ClientApi }).feishuPreview.diagnostics.slice(start),
    result.diagnosticStart,
  );
  return {
    png,
    renderer: 'client',
    compiled: result.compiled!,
    warnings: [...resourceWarnings(result.compiled!), ...diagnosticWarnings(diagnostics)],
  };
}

async function renderSimulator(
  page: Page,
  url: string,
  project: CardProject,
  { locale, platform, theme }: RenderSettings,
): Promise<RenderResult> {
  await page.goto(url);
  await waitForBootstrap(page, '#local-status');
  const previousFrame = await page.locator('iframe[title="nclc-runtime-frame"]').elementHandle();
  const result = await withTimeout(
    page.evaluate(
      async (input) => {
        try {
          const editor = (window as unknown as { localCardKit: EditorApi }).localCardKit;
          const diagnosticStart = editor.diagnostics.length;
          const compiled = await editor.load(input.card, input.variables, input.locale);
          return { compiled, exported: editor.exportProject().card, diagnosticStart };
        } catch (error) {
          const failure = error as Error & { code?: string; details?: unknown };
          return {
            error: {
              code: failure.code ?? 'render_failed',
              message: failure.message,
              details: failure.details,
            },
          };
        }
      },
      { card: project.card, variables: project.variables ?? [], locale },
    ),
    'simulator',
  );
  if (result.error) throw asCardError(result.error, 'render_failed');
  if (previousFrame) await page.waitForFunction((frame) => !frame.isConnected, previousFrame);
  if (platform === 'ios')
    await page.locator('.designer-bar.toolbar .ud__radio-button__wrapper').nth(1).click();
  const frame = page.frameLocator('iframe[title="nclc-runtime-frame"]');
  const card = frame.locator(platform === 'ios' ? '.ub__root-mobile' : '.ub__root-laptop');
  await card.locator(':scope > *').first().waitFor({ state: 'attached' });
  if (await card.locator('.ub__root-empty').count())
    throw new CardError(
      'simulator_empty_card',
      'The simulator shows an editor placeholder for an empty card.',
    );
  if (await card.locator('.ub__component-error').count())
    throw new CardError(
      'simulator_render_failed',
      'The simulator reported a component rendering error.',
    );
  // CardKit applies its dark token palette through this attribute, not the browser color scheme.
  if (theme === 'dark') await card.evaluate((element) => element.setAttribute('_pp-theme', 'dark'));
  await frame.locator('html').evaluate(() => document.fonts.ready);
  const png = await card.screenshot({ type: 'png' });
  const diagnostics = await page.evaluate(
    (start) =>
      (window as unknown as { localCardKit: EditorApi }).localCardKit.diagnostics.slice(start),
    result.diagnosticStart,
  );
  return {
    png,
    renderer: 'simulator',
    compiled: result.compiled!,
    warnings: [
      ...conversionWarnings(project.card, result.exported),
      ...resourceWarnings(result.compiled!),
      ...diagnosticWarnings(diagnostics),
    ],
  };
}

export function renderPage(
  page: Page,
  url: string,
  project: CardProject,
  settings: RenderSettings,
): Promise<RenderResult> {
  return (settings.renderer === 'client' ? renderClient : renderSimulator)(
    page,
    url,
    project,
    settings,
  );
}
