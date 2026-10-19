/** Friendly error messages for signal collection failures. */

/** URL schemes Chrome never allows extensions to script. */
export const RESTRICTED_RE = /^(chrome|chrome-extension|edge|about|view-source):/;

/** Hosts Chrome never allows extensions to script, even over https. */
export const BLOCKED_HOSTS_RE = /(^|\.)chromewebstore\.google\.com$|(^|\.)chrome\.google\.com$/;

/**
 * Translate Chrome's cryptic scripting errors into helpful messages.
 * Pure function — safe to unit test.
 */
export function friendlyCollectError(raw: string, url: string): string {
  const lower = raw.toLowerCase();
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* ignore invalid URLs */
  }
  if (
    BLOCKED_HOSTS_RE.test(hostname) ||
    lower.includes('extensions gallery') ||
    lower.includes('cannot be scripted')
  ) {
    return 'Chrome does not allow extensions to run on the Web Store or other browser pages. Open any company website (for example, stripe.com) and click the Prospect Brief icon there.';
  }
  if (lower.includes('chrome://') || lower.includes('cannot access a chrome')) {
    return 'Chrome does not allow extensions to run on browser pages like settings or the new tab page. Open any company website and try again.';
  }
  if (lower.includes('cannot access contents of url')) {
    return 'This page does not allow extensions to read it. Try a regular company website instead.';
  }
  return raw;
}
