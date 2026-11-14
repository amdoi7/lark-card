import { expect, test } from 'bun:test';
import { verifyUi } from './ui.ts';

type ClientPreview = {
  render(card: unknown): Promise<{ card: { schema: string } }>;
  migrate(
    card: unknown,
  ): Promise<{ card: { schema: string }; compiled: { card: { schema: string } } }>;
};

test('client preview rejects an invalid component and renders a corrected card', async () => {
  await verifyUi('/preview', async ({ page }) => {
    await page.waitForFunction(() =>
      ['ready', 'error'].includes(document.querySelector<HTMLElement>('#status')!.dataset.state!),
    );
    expect(await page.locator('#status').getAttribute('data-state')).toBe('ready');
    const rejection = await page.evaluate(async () => {
      const preview = (window as unknown as { feishuPreview: ClientPreview }).feishuPreview;
      return preview
        .render({ schema: '2.0', body: { elements: [{ tag: 'not_a_component' }] } })
        .then(
          () => '',
          (error) => error.message as string,
        );
    });
    expect(rejection).toContain('card_compile_failed');
    expect(await page.locator('#status').getAttribute('data-state')).toBe('error');
    const text = await page.evaluate(async () => {
      const preview = (window as unknown as { feishuPreview: ClientPreview }).feishuPreview;
      await preview.render({
        schema: '2.0',
        body: { elements: [{ tag: 'markdown', content: 'Recovered preview' }] },
      });
      return document.querySelector<HTMLElement>('#card-root')!.innerText;
    });
    expect(text).toContain('Recovered preview');
    expect(await page.locator('#status').getAttribute('data-state')).toBe('ready');
  });
}, 120000);

test('client preview renders V1 and migrates it to V2 on request', async () => {
  await verifyUi('/preview', async ({ page }) => {
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>('#status')!.dataset.state === 'ready',
    );
    const result = await page.evaluate(async () => {
      const preview = (window as unknown as { feishuPreview: ClientPreview }).feishuPreview;
      const card = {
        config: { update_multi: true },
        elements: [{ tag: 'markdown', content: 'Legacy text' }],
      };
      const compiled = await preview.render(card);
      const migrated = await preview.migrate(card);
      return {
        original: compiled.card.schema,
        migrated: migrated.card.schema,
        vr: migrated.compiled.card.schema,
        text: document.querySelector<HTMLElement>('#card-root')!.innerText,
      };
    });
    expect(result).toEqual({ original: '1.0', migrated: '2.0', vr: '2.0', text: 'Legacy text' });
  });
}, 120000);
