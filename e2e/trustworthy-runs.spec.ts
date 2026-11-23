import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * v0.4 trustworthy-runs e2e (inc-013): a mixed batch (ok / partial /
 * failed) runs through the REAL extension UI + background, the run
 * summary shows exact counts, and retry researches only the
 * partial/failed domains.
 *
 * No live external network: every request the extension makes is
 * intercepted at the Playwright context boundary — prospect
 * homepages, the Google News RSS feed, and the Anthropic API are
 * fulfilled locally, and anything else is aborted and recorded.
 */

const EXTENSION_PATH = path.resolve(process.cwd(), '.output/chrome-mv3');

const BRIEF_JSON = JSON.stringify({
  overview: 'Example company sells widgets to other businesses.',
  overviewRefs: [],
  talkingPoints: [
    { point: 'They sell widgets; ask about widget volume.', sourceRefs: [], stackRefs: [], basis: 'site' },
  ],
});

const HOMEPAGE_HTML =
  '<!doctype html><html><head><title>Example Co</title></head><body><h1>Widgets for business</h1><p>We sell widgets.</p></body></html>';

const EMPTY_RSS =
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>news</title></channel></rss>';

/** Every Anthropic request the extension made, in order (per test run). */
const anthropicCalls: Array<{ domain: string | null }> = [];
/** Any http(s) request that was NOT stubbed and had to be aborted. */
const unstubbedRequests: string[] = [];

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // Playwright resolves fixture dependencies from the destructured
  // parameter names, so the empty pattern here is required shape.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, run) => {
    anthropicCalls.length = 0;
    unstubbedRequests.length = 0;
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    // Catch-all FIRST (Playwright matches routes in reverse
    // registration order, so the specific stubs below win): abort
    // and record anything that is not stubbed — no live calls.
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        unstubbedRequests.push(url);
        await route.abort();
        return;
      }
      await route.continue();
    });

    // Prospect homepages, fetched by the batch collector.
    for (const domain of ['a.com', 'b.com', 'c.com']) {
      await context.route(`https://${domain}/**`, async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: HOMEPAGE_HTML });
      });
    }

    // Google News RSS: a valid, empty feed.
    await context.route('https://news.google.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/rss+xml', body: EMPTY_RSS });
    });

    // Anthropic API: behaviour keyed by the prospect URL in the
    // prompt — a.com completes, b.com stops at max_tokens with a
    // schema-valid brief (→ partial), c.com errors (→ failed).
    await context.route('https://api.anthropic.com/**', async (route) => {
      const body = route.request().postDataJSON() as {
        messages?: Array<{ content?: string }>;
      } | null;
      const prompt = body?.messages?.[0]?.content ?? '';
      const domain = /URL: https:\/\/([a-z]+\.com)\//.exec(prompt)?.[1] ?? null;
      anthropicCalls.push({ domain });
      if (domain === 'c.com') {
        await route.fulfill({ status: 500, contentType: 'text/plain', body: 'overloaded' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: [{ type: 'text', text: BRIEF_JSON }],
          stop_reason: domain === 'b.com' ? 'max_tokens' : 'end_turn',
        }),
      });
    });

    await run(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, run) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await run(worker.url().split('/')[2]);
  },
});

test('mixed batch: exact summary counts, retry researches only partial/failed', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a (fake) API key directly in extension storage.
  await page.evaluate(async () => {
    await chrome.storage.local.set({ apiKey: 'e2e-test-key', model: 'claude-sonnet-4-5' });
  });

  await page.getByRole('button', { name: 'Accounts' }).click();
  await page.getByLabel('Domains to research').fill('a.com\nb.com\nc.com');
  await page.getByRole('button', { name: 'Start batch' }).click();

  // The batch completes (its state record is removed) and the
  // durable run summary appears with exact counts.
  await expect(page.getByText('Last batch: 1 ok · 1 partial · 1 failed of 3')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/b\.com: partial/)).toBeVisible();
  await expect(page.getByText(/c\.com: failed/)).toBeVisible();

  // First pass researched each domain (c.com at least twice: the
  // generation path's one retry on error), and nothing unstubbed
  // left the sandbox.
  const firstPass = anthropicCalls.map((c) => c.domain);
  expect(firstPass.filter((d) => d === 'a.com')).toHaveLength(1);
  expect(firstPass.filter((d) => d === 'b.com')).toHaveLength(1);
  expect(firstPass.filter((d) => d === 'c.com').length).toBeGreaterThanOrEqual(1);
  expect(unstubbedRequests).toEqual([]);

  // Retry is offered for exactly the partial + failed domains.
  const callsBeforeRetry = anthropicCalls.length;
  await page.getByRole('button', { name: 'Retry 2 partial/failed' }).click();

  // The retry batch (2 domains) completes and becomes the latest
  // summary: still 1 partial + 1 failed, now of 2, with no ok.
  await expect(page.getByText('Last batch: 0 ok · 1 partial · 1 failed of 2')).toBeVisible({
    timeout: 60_000,
  });

  // The retry researched ONLY b.com and c.com — a.com (ok) was
  // never re-researched.
  const retryCalls = anthropicCalls.slice(callsBeforeRetry).map((c) => c.domain);
  expect(retryCalls).toContain('b.com');
  expect(retryCalls).toContain('c.com');
  expect(retryCalls).not.toContain('a.com');
  expect(unstubbedRequests).toEqual([]);
});
