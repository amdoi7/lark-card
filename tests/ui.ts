import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { startPreviewServer } from '../src/engine/preview/server.ts';

type UiContext = {
  page: Page;
  server: Awaited<ReturnType<typeof startPreviewServer>>;
  failures: string[];
  requests: string[];
};

export async function verifyUi(
  path: '/' | '/preview',
  verify: (context: UiContext) => Promise<void>,
) {
  const server = await startPreviewServer({
    port: 0,
    renderer: path === '/preview' ? 'client' : 'simulator',
  });
  try {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.LARK_CARD_CHROME,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        deviceScaleFactor: 1,
      });
      const failures: string[] = [],
        requests: string[] = [];
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('requestfailed', (request) =>
        failures.push(`${request.url()}: ${request.failure()?.errorText}`),
      );
      page.on('response', (response) => {
        if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
      });
      page.on('request', (request) => requests.push(request.url()));
      try {
        await page.goto(server.url + path);
        await verify({ page, server, failures, requests });
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
    await server.close();
  }
}
