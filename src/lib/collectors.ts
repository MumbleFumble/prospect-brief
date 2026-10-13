import type { DomSignals, MainWorldSignals, PageSignals } from './types';

/**
 * Signal collectors for step 2.
 *
 * Both functions are injected via chrome.scripting.executeScript, so they
 * must be FULLY SELF-CONTAINED: no imports, no references to module-level
 * constants or helpers (only the function body is serialized). All
 * constants and helpers are defined inside the function bodies.
 */

/**
 * Runs in the MAIN world. Checks for known window globals and posts
 * the results back; the isolated collector listens for the message.
 */
export function collectMainWorldSignals(): void {
  const MESSAGE = 'PROSPECT_BRIEF_GLOBALS';
  const w = window as unknown as Record<string, unknown>;
  const payload: MainWorldSignals = {
    reactDevtoolsHook: w['__REACT_DEVTOOLS_GLOBAL_HOOK__'] !== undefined,
    nextData: document.getElementById('__NEXT_DATA__') !== null,
    nuxtData: w['__NUXT__'] !== undefined,
    shopify: w['Shopify'] !== undefined,
    dataLayer: Array.isArray(w['dataLayer']),
    googleAnalytics: w['ga'] !== undefined || w['gtag'] !== undefined,
    intercom: w['Intercom'] !== undefined,
    stripe: w['Stripe'] !== undefined,
    hubspot: w['hubspot'] !== undefined || w['_hsq'] !== undefined,
    segment: w['analytics'] !== undefined,
  };
  window.postMessage({ type: MESSAGE, payload }, '*');
}

/**
 * Runs in the ISOLATED world. Collects DOM signals and waits (briefly)
 * for the main-world globals posted via postMessage.
 */
export async function collectDomSignals(): Promise<PageSignals> {
  const MESSAGE = 'PROSPECT_BRIEF_GLOBALS';
  const TIMEOUT_MS = 2000;
  const TEXT_BUDGET = 2000;

  const textOf = (el: Element | null, budget: number): string => {
    if (!el) return '';
    const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return raw.slice(0, budget);
  };

  const mainWorld: Promise<MainWorldSignals | null> = new Promise((resolve) => {
    const handler = (e: MessageEvent) => {
      const d = e.data as { type?: string; payload?: MainWorldSignals };
      if (d && d.type === MESSAGE) {
        window.removeEventListener('message', handler);
        resolve(d.payload ?? null);
      }
    };
    window.addEventListener('message', handler);
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, TIMEOUT_MS);
  });

  const meta = (name: string): string | null => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return el?.getAttribute('content') ?? null;
  };

  const ogTags: Record<string, string> = {};
  document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]').forEach((el) => {
    const key = el.getAttribute('property') || el.getAttribute('name') || '';
    const val = el.getAttribute('content') || '';
    if (key && val) ogTags[key] = val;
  });

  const scriptSrcs: string[] = [];
  document.querySelectorAll('script[src]').forEach((el) => {
    const src = el.getAttribute('src');
    if (src) scriptSrcs.push(src);
  });

  const linkHrefs: string[] = [];
  document.querySelectorAll('link[href]').forEach((el) => {
    const href = el.getAttribute('href');
    if (href) linkHrefs.push(href);
  });

  // Cookie names only — never values.
  const cookieNames = document.cookie
    .split(';')
    .map((c) => c.split('=')[0]?.trim())
    .filter((n): n is string => !!n);

  // Visible text: hero, nav, footer share the budget.
  const hero = document.querySelector('main, [role="main"], .hero, #hero, header');
  const nav = document.querySelector('nav');
  const footer = document.querySelector('footer');
  const perSection = Math.floor(TEXT_BUDGET / 3);
  const visibleText = [
    textOf(hero, perSection),
    textOf(nav, perSection),
    textOf(footer, perSection),
  ]
    .filter(Boolean)
    .join('\n---\n');

  const dom: DomSignals = {
    url: location.href,
    title: document.title,
    metaDescription: meta('description'),
    generator: meta('generator'),
    ogTags,
    visibleText,
    scriptSrcs,
    linkHrefs,
    cookieNames,
  };

  return {
    dom,
    mainWorld: await mainWorld,
    collectedAt: Date.now(),
  };
}
