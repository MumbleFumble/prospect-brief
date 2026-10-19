import { describe, expect, it } from 'vitest';
import { friendlyCollectError, RESTRICTED_RE, BLOCKED_HOSTS_RE } from './errors';

describe('friendlyCollectError', () => {
  it('translates the Web Store gallery error', () => {
    const msg = friendlyCollectError(
      'The extensions gallery cannot be scripted.',
      'https://chromewebstore.google.com/detail/xxx',
    );
    expect(msg).toContain('Web Store');
    expect(msg).toContain('stripe.com');
    expect(msg).not.toContain('gallery');
  });

  it('catches Web Store URLs even with a generic error', () => {
    const msg = friendlyCollectError(
      'Something went wrong',
      'https://chromewebstore.google.com/detail/xxx',
    );
    expect(msg).toContain('Web Store');
  });

  it('translates chrome:// errors', () => {
    const msg = friendlyCollectError('Cannot access a chrome:// URL', 'chrome://settings');
    expect(msg).toContain('browser pages');
  });

  it('translates content access errors', () => {
    const msg = friendlyCollectError(
      'Cannot access contents of url "https://example.com/"',
      'https://example.com/',
    );
    expect(msg).toContain('does not allow');
  });

  it('passes through unknown errors unchanged', () => {
    const raw = 'Network timeout while fetching';
    expect(friendlyCollectError(raw, 'https://example.com/')).toBe(raw);
  });

  it('handles empty URLs without throwing', () => {
    expect(() => friendlyCollectError('blocked', '')).not.toThrow();
  });
});

describe('RESTRICTED_RE', () => {
  it('matches chrome: schemes', () => {
    expect(RESTRICTED_RE.test('chrome://settings')).toBe(true);
    expect(RESTRICTED_RE.test('about:blank')).toBe(true);
  });
  it('does not match https:', () => {
    expect(RESTRICTED_RE.test('https://stripe.com/')).toBe(false);
  });
});

describe('BLOCKED_HOSTS_RE', () => {
  it('matches the Web Store', () => {
    expect(BLOCKED_HOSTS_RE.test('chromewebstore.google.com')).toBe(true);
  });
  it('does not match regular sites', () => {
    expect(BLOCKED_HOSTS_RE.test('stripe.com')).toBe(false);
  });
});
