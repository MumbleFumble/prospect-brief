# Privacy Policy — Prospect Brief

**Last updated:** October 12, 2026

Prospect Brief is a Chrome extension that generates one-page sales briefs for company websites. This policy explains what data the extension handles and how.

## Data stored locally

- **Anthropic API key and model choice.** Stored in `chrome.storage.local` on your device when you enter them in the extension's Options page. The key is never hardcoded, never committed to source code, and never sent anywhere except `api.anthropic.com`.
- **Cached briefs.** Completed briefs are cached per-domain in `chrome.storage.local` for 24 hours to avoid repeat API calls. You can clear a domain's cache anytime with the Regenerate button.

## Data sent over the network

When you click the Prospect Brief icon on a company website:

1. **Page signals** (page title, meta tags, visible text, script URLs, detected tech stack, cookie names — never cookie values) are sent to `api.anthropic.com` along with your API key, so Claude can generate the overview and talking points. This is governed by Anthropic's privacy policy.
2. **A company name derived from the page** (e.g. from the site title or domain) is sent to `news.google.com` to fetch recent headlines via Google News RSS.

No data is sent to any other third party. There is no backend server operated by the extension author.

## What we don't do

- No analytics, telemetry, or user tracking of any kind.
- No advertising.
- We do not sell, share, or disclose your data to anyone except as described above (Anthropic for brief generation, Google News for headlines).

## Data retention

Cached briefs expire automatically after 24 hours. Your API key persists until you change or remove it in the Options page. Uninstalling the extension removes all locally stored data.

## Contact

For questions about this policy, open an issue at https://github.com/MumbleFumble/prospect-brief.
