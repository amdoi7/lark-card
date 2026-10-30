import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { startPreview } from '../runtime/serve.ts';

type UiContext = {
  page: Page;
  preview: Awaited<ReturnType<typeof startPreview>>;
  failures: string[];
  requests: string[];
};

export async function verifyUi(path: '/' | '/preview', verify: (context: UiContext) => Promise<void>) {
  const preview = await startPreview({ port: 0, renderer: path === '/preview' ? 'client' : 'simulator' });
  try {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.LARK_CARD_CHROME });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
      const failures: string[] = [], requests: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
      page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
      page.on('request', request => requests.push(request.url()));
      try {
        await page.goto(preview.url + path);
        await verify({ page, preview, failures, requests });
      } catch (error) {
        const artifacts = await mkdtemp(join(tmpdir(), 'lark-card-evidence-'));
        try {
          const evidence = await page.evaluate(() => ({
            status: document.querySelector('[role=status]')?.textContent,
            html: document.body.innerHTML,
            frame: document.querySelector('iframe')?.contentDocument?.documentElement?.outerHTML,
          }));
          await writeFile(join(artifacts, 'failure.json'), JSON.stringify(evidence, null, 2));
          await page.screenshot({ path: join(artifacts, 'failure.png') });
        } catch (captureError) {
          console.error(`evidence_capture_failed cause=${(captureError as Error).message}`);
        }
        console.error(`browser_verification_failed artifacts=${artifacts}`);
        throw error;
      }
    } finally {
      await browser.close();
    }
  } finally {
    await preview.close();
  }
}
