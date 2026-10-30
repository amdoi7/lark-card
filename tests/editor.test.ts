import { expect, test } from 'bun:test';
import { verifyUi } from './ui.ts';

test('editor applies JSON changes and component settings to the card', async () => {
  await verifyUi('/', async ({ page, failures, requests, server }) => {
    await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector<HTMLElement>('#local-status')!.dataset.state!));
    expect(await page.locator('#local-status').getAttribute('data-state')).toBe('ready');
    const frame = page.frameLocator('iframe[title="nclc-runtime-frame"]');
    await frame.getByText('项目小助理', { exact: true }).waitFor();
    await page.locator('#source-panel summary').click();
    const source = page.locator('#card-source');
    const card = JSON.parse(await source.inputValue());
    card.header.title.content = 'Customized editor title';
    card.header.title.i18n_content.zh_cn = 'Customized editor title';
    await source.fill(JSON.stringify(card));
    await page.locator('#apply-source').click();
    await frame.getByText('Customized editor title', { exact: true }).waitFor();
    await page.locator('.left-pane .panel-tab').nth(1).click();
    await page.locator('.tree-node[data-id^=Body] .tree-node-title').click();
    const spacing = page.locator('[data-field-id^=verticalSpacing_] input');
    await spacing.fill('24');
    await spacing.blur();
    await page.waitForFunction(() => JSON.parse(document.querySelector<HTMLTextAreaElement>('#card-source')!.value).body.vertical_spacing === '24px');
    const project = await page.evaluate(async () => {
      const editor = (window as unknown as { localCardKit: { settled(): Promise<void>; exportProject(): { card: { body: { vertical_spacing: string } } } } }).localCardKit;
      await editor.settled();
      return editor.exportProject();
    });
    expect(project.card.body.vertical_spacing).toBe('24px');
    expect(requests.filter(url => /^https?:/.test(url) && !url.startsWith(server.url + '/'))).toEqual([]);
    expect(failures).toEqual([]);
  });
}, 120000);

test('simulator shows Markdown link text', async () => {
  await verifyUi('/', async ({ page }) => {
    await page.waitForFunction(() => document.querySelector<HTMLElement>('#local-status')!.dataset.state === 'ready');
    const frame = page.frameLocator('iframe[title="nclc-runtime-frame"]');
    await frame.getByText('项目小助理', { exact: true }).waitFor();
    const card = { schema: '2.0', body: { elements: [{ tag: 'markdown', content: '当前文书：[会议记录](https://example.invalid/record)' }] } };
    await page.locator('#file-input').setInputFiles({ name: 'card.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(card)) });
    await frame.getByText('会议记录', { exact: true }).waitFor();
    expect(await frame.locator('.ub__root').innerText()).toContain('当前文书：会议记录');
  });
}, 120000);
