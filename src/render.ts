import { chromium, type Page } from 'playwright-core';
import { startPreview } from '../runtime/serve.ts';
import { transformNodes } from '../runtime/input.ts';
import type { CardProject, CompiledCard, Preview, PreviewOptions, PreviewWarning } from './core';

type Diagnostic = { operation: string; detail: unknown };
type EditorApi = { load(card: unknown, variables: readonly unknown[], locale: string): Promise<CompiledCard>; exportProject(): { card: unknown }; diagnostics: Diagnostic[] };
type ClientApi = { render(card: unknown): Promise<CompiledCard>; diagnostics: Diagnostic[] };

export class RenderError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function conversionWarnings(input: unknown, exported: unknown): PreviewWarning[] {
  function components(card: unknown) {
    const tags = new Map<string, string[]>();
    transformNodes(card, (node, path) => {
      if (typeof node.tag === 'string') tags.set(node.tag, [...(tags.get(node.tag) ?? []), path]);
      return node;
    });
    return tags;
  }
  const original = components(input), converted = components(exported);
  return [...original].flatMap(([tag, candidatePaths]) => {
    const exportedCount = converted.get(tag)?.length ?? 0;
    return exportedCount < candidatePaths.length ? [{
      code: 'simulator_component_count_decreased' as const, tag,
      inputCount: candidatePaths.length, exportedCount, candidatePaths,
    }] : [];
  });
}

function resourceWarnings(compiled: CompiledCard): PreviewWarning[] {
  const attachment = compiled.attachment as Record<string, Record<string, unknown>>;
  const resources = ['images', 'atUsers', 'characters'].filter(name => Object.keys(attachment[name] ?? {}).length > 0);
  return resources.length ? [{ code: 'resource_unresolved', resources }] : [];
}

function diagnosticWarnings(diagnostics: Diagnostic[]): PreviewWarning[] {
  const relevant = new Set(['host.unavailable', 'frame.error', 'engine.error', 'render.failed', 'resource.resolve', 'runtime.error', 'runtime.rejection']);
  return diagnostics.filter(item => relevant.has(item.operation)).map(item => ({ code: 'renderer_diagnostic', ...item }));
}

async function bounded<T>(promise: Promise<T>, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error(`render_timeout operation=${operation} limit_ms=30000`)), 30000);
  })]).finally(() => clearTimeout(timer));
}

async function ready(page: Page, selector: string) {
  await page.waitForFunction(selector => {
    const state = document.querySelector<HTMLElement>(selector)!.dataset.state;
    return state === 'ready' || state === 'error';
  }, selector);
  const status = await page.locator(selector).evaluate(element => ({ state: (element as HTMLElement).dataset.state, message: element.textContent }));
  if (status.state !== 'ready') throw Error(`preview_bootstrap_failed message=${JSON.stringify(status.message)}`);
}

export async function renderCard(project: CardProject, options: PreviewOptions): Promise<Preview> {
  const renderer = options.renderer ?? 'simulator';
  const locale = options.locale ?? 'zh_cn';
  const platform = options.platform ?? 'pc';
  const theme = options.theme ?? 'light';
  const preview = await startPreview({ port: 0, renderer, webcontent: options.webcontent });
  try {
    const browser = await chromium.launch({ headless: true, executablePath: options.chrome });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
      if (renderer === 'client') {
        await page.goto(preview.url + '/preview');
        await ready(page, '#status');
        const result = await bounded(page.evaluate(async input => {
          document.querySelector<HTMLTextAreaElement>('#variables')!.value = JSON.stringify(input.variables);
          document.querySelector<HTMLSelectElement>('#platform')!.value = input.platform;
          document.querySelector<HTMLSelectElement>('#theme')!.value = input.theme;
          const localeControl = document.querySelector<HTMLSelectElement>('#locale')!;
          localeControl.value = input.locale;
          if (localeControl.value !== input.locale) throw Error('locale_invalid value=' + input.locale);
          try {
            const client = (window as unknown as { feishuPreview: ClientApi }).feishuPreview;
            const diagnosticStart = client.diagnostics.length;
            const compiled = await client.render(input.card);
            await document.fonts.ready;
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            return { compiled, diagnosticStart };
          } catch (error) {
            const failure = error as Error & { code?: string; details?: unknown };
            return { error: { code: failure.code ?? 'render_failed', message: failure.message, details: failure.details } };
          }
        }, { card: project.card, variables: project.variables ?? [], platform, theme, locale }), 'client');
        if (result.error) throw new RenderError(result.error.code, result.error.message, result.error.details);
        const png = await page.locator('#preview-card').screenshot({ type: 'png' });
        const diagnostics = await page.evaluate(start => (window as unknown as { feishuPreview: ClientApi }).feishuPreview.diagnostics.slice(start), result.diagnosticStart);
        return { png, renderer, compiled: result.compiled!, warnings: [...resourceWarnings(result.compiled!), ...diagnosticWarnings(diagnostics)] };
      }

      await page.goto(preview.url);
      await ready(page, '#local-status');
      const previousFrame = await page.locator('iframe[title="nclc-runtime-frame"]').elementHandle();
      const result = await bounded(page.evaluate(async input => {
        try {
          const editor = (window as unknown as { localCardKit: EditorApi }).localCardKit;
          const diagnosticStart = editor.diagnostics.length;
          const compiled = await editor.load(input.card, input.variables, input.locale);
          return { compiled, exported: editor.exportProject().card, diagnosticStart };
        } catch (error) {
          const failure = error as Error & { code?: string; details?: unknown };
          return { error: { code: failure.code ?? 'render_failed', message: failure.message, details: failure.details } };
        }
      }, { card: project.card, variables: project.variables ?? [], locale }), 'simulator');
      if (result.error) throw new RenderError(result.error.code, result.error.message, result.error.details);
      if (previousFrame) await page.waitForFunction(frame => !frame.isConnected, previousFrame);
      if (platform === 'ios') await page.locator('.designer-bar.toolbar .ud__radio-button__wrapper').nth(1).click();
      const frame = page.frameLocator('iframe[title="nclc-runtime-frame"]');
      const card = frame.locator(platform === 'ios' ? '.ub__root-mobile' : '.ub__root-laptop');
      await card.locator(':scope > *').first().waitFor({ state: 'attached' });
      if (await card.locator('.ub__root-empty').count()) throw new RenderError('simulator_empty_card', 'The simulator shows an editor placeholder for an empty card.');
      if (await card.locator('.ub__component-error').count()) throw new RenderError('simulator_render_failed', 'The simulator reported a component rendering error.');
      // CardKit applies its dark token palette through this attribute, not the browser color scheme.
      if (theme === 'dark') await card.evaluate(element => element.setAttribute('_pp-theme', 'dark'));
      await frame.locator('html').evaluate(() => document.fonts.ready);
      const png = await card.screenshot({ type: 'png' });
      const diagnostics = await page.evaluate(start => (window as unknown as { localCardKit: EditorApi }).localCardKit.diagnostics.slice(start), result.diagnosticStart);
      return { png, renderer, compiled: result.compiled!, warnings: [...conversionWarnings(project.card, result.exported), ...resourceWarnings(result.compiled!), ...diagnosticWarnings(diagnostics)] };
    } finally {
      await browser.close();
    }
  } finally {
    await preview.close();
  }
}
