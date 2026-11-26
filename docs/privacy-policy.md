# Privacy Policy — Prospect Brief

**Last updated:** November 25, 2026

Prospect Brief is a Chrome extension that generates one-page sales briefs for company websites. This policy explains what data the extension handles and how.

## Data stored locally

All of the following stays on your device, in your browser's storage for this extension:

- **Anthropic API key, model choice, and seller profile.** Stored in `chrome.storage.local` when you enter them in the extension's Options page (settings keys `apiKey`, `model`, `sellerProfile`). The seller profile is the text you enter about what you sell, your ideal customer, your value props, and competitor names. The API key is never hardcoded, never committed to source code, and never sent anywhere except `api.anthropic.com`.
- **Cached briefs.** Completed briefs are cached per-domain in `chrome.storage.local` (key `brief:<domain>`, including the brief, the collected page signals, detections, news, and hiring signals) for 24 hours to avoid repeat API calls. A stale entry is removed the next time it is read. You can clear a domain's cache anytime with the Regenerate button.
- **Saved briefs.** Every generated brief is also saved to a history list in `chrome.storage.local` (key `saved:briefs`). Saved briefs do not expire; the list is capped at the 100 most recent (one per domain). You can delete individual saved briefs or clear the list.
- **Account records.** Briefs and research are kept as account records in an IndexedDB database named `prospect-brief` (object store `accounts`, keyed by domain). Each record holds the latest brief, timestamped signal snapshots (detections, news, and hiring signals; capped at the 10 most recent per account), a pipeline status, any notes you write, a log of outreach touches you draft or mark sent, and — for watched accounts — the watch state and change events. Account records persist until you delete the account or uninstall the extension. A one-time migration flag (`accounts:migrated:v1` in `chrome.storage.local`) records that your pre-v0.3 saved briefs were converted into account records; the old saved-briefs list is left in place.
- **Run records.** The same IndexedDB database has a second object store (`runs`) holding one record per brief generation: the domain, the finish time, the outcome (completed, partial, or failed, with the reason), and the batch id for batch runs. Run records are capped at the 500 most recent and are used to show batch run summaries and to resume interrupted batches.
- **Batch queue state.** If you start batch research, the queue (the domains, their per-item status, and a processor heartbeat) is stored in `chrome.storage.local` (key `batch:state`) so an interrupted batch can resume.
- **Scoring weights.** If you adjust the account-scoring weights, your weights are stored in `chrome.storage.local` (key `scoringWeights`).

You can also take your data out of the extension, always by your own action: export your account records to a JSON file; export your saved briefs to a CSV file; copy a brief as Markdown text; copy a saved brief as a plain-text CRM note; or print a brief / save it as PDF. Exported files and copied text are created only when you choose to export or copy, they go only where you save or paste them, and none of them contains your API key or any of your settings — exports contain briefs and account records only.

## Data sent over the network

1. **Anthropic (`api.anthropic.com`).** Page signals (page title, meta tags, visible text, script URLs, detected tech stack, cookie names — never cookie values), recent headlines, and hiring signals are sent along with your API key, so Claude can generate the overview and talking points. If you have filled in a seller profile, that text is included in the prompt so the output can be framed around what you sell. The same applies when you draft an outreach email or a follow-up sequence. This is governed by Anthropic's privacy policy.
2. **Google News (`news.google.com`).** A company name derived from the page (e.g. from the site title or domain) is sent to fetch recent headlines via Google News RSS.
3. **Job-board APIs (Greenhouse, Lever, Ashby).** If a company's site links to a public job board on one of these services, the board identifier taken from that link is sent to that service's public API (`boards-api.greenhouse.io`, `api.lever.co`, or `api.ashbyhq.com`) to fetch its open roles as hiring signals.
4. **Prospect websites.** For batch research and for the periodic re-checks of watched accounts, the extension fetches the prospect site's own homepage HTML directly. Nothing about you is sent in those requests beyond the fetch itself.

No data is sent to any other third party. There is no backend server operated by the extension author.

## What we don't do

- No analytics, telemetry, or user tracking of any kind.
- No advertising.
- We do not sell, share, or disclose your data to anyone except as described above (Anthropic for brief generation, Google News for headlines, and the job-board APIs for hiring signals).

## Data retention

Cached briefs expire automatically after 24 hours. Saved briefs persist until you delete them or clear the list (capped at 100). Run records persist until the 500-record cap pushes the oldest out. Account records, your settings and seller profile, scoring weights, and batch queue state persist until you delete or change them. Your API key persists until you change or remove it in the Options page. Uninstalling the extension removes all locally stored data.

## Contact

For questions about this policy, open an issue at https://github.com/MumbleFumble/prospect-brief.
