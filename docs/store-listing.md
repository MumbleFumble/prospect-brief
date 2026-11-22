# Chrome Web Store Listing — Prospect Brief

## Name

Prospect Brief

## Short description (132 chars max)

One-click account briefs for any company website: AI overview, tech stack, recent news, and talking points.

## Detailed description

Prospect Brief turns any company website into a one-page sales brief in seconds.

**How it works**

1. Visit a prospect's website.
2. Click the Prospect Brief toolbar icon.
3. Get an AI-generated overview, detected tech stack, recent headlines, and talking points — all in the side panel.

**What's in the brief**

- **Overview** — a 3–4 sentence summary of what the company does, grounded in their own site content.
- **Talking points** — 3–5 conversation starters, each linked to the news headline it came from.
- **Tech stack** — deterministic detection of ~40 technologies (frameworks, analytics, CMS, hosting, payments, auth, chat, marketing) with the evidence behind each call.
- **Recent news** — latest headlines from Google News, so you walk in current.

**Beyond the brief**

- **Account records** — every brief saves as a persistent account record with timestamped signal snapshots, a pipeline status, notes, and an outreach touch log.
- **List intake & batch research** — paste or import a list of domains and research them in batch, with an upfront API cost estimate; batch snapshots from fetched HTML are labelled as partial detection.
- **Account scoring** — a deterministic score (ICP fit × signal strength/recency) with a visible per-point breakdown naming its evidence.
- **Personas & sequences** — pick from a standard persona list or personas suggested from hiring signals, and get a drafted 3-touch sequence per persona (day 1 email, day 4 LinkedIn, day 9 email), each touch anchored on a different signal. Touches are drafted only — you copy, send, and mark them sent by hand.
- **Watch & re-engage, in a Today view** — watched accounts are re-checked every 6 hours (only while Chrome is open); changes surface as events and an icon badge, and the model is only called when something changed. The Today home view brings together new signals, touches due, and your top accounts by score.

**Privacy-first**

- No backend server. No analytics. No tracking.
- Your Anthropic API key stays in your browser (chrome.storage.local) and is only sent to api.anthropic.com.
- Everything is stored locally, on your device: your settings and seller profile, cached briefs (24 hours), saved briefs, account records in IndexedDB (signal snapshots, notes, and outreach touches), batch queue state, and scoring weights.
- Page analysis runs locally. The only network calls are to Anthropic (brief, outreach, and sequence generation — page signals, headlines, hiring signals, and your seller profile if you set one), Google News (headline search), the public Greenhouse / Lever / Ashby job-board APIs (hiring signals, using the board identifier from the company's own site), and the prospect websites you research (their homepage HTML, fetched for batch research and watch re-checks).

**Export**

- Copy as Markdown for your CRM or notes.
- Print / Save as PDF for a clean one-pager.

**Requirements**

- Bring your own Anthropic API key (set it in the extension options).

## Category

Productivity

## Screenshots (1280×800)

1. `store-shots/shot1-brief.png` — Side panel showing a completed brief (overview + talking points).
2. `store-shots/shot2-stack.png` — Tech stack section with confidence badges and evidence.
3. `store-shots/shot3-export.png` — Export view.

Not yet captured: an options page screenshot (no file in `store-shots/`).

## Icon

See `public/icons/` (16/32/48/128 PNG).

## Permissions justification

- `activeTab` — access the current tab when you click the toolbar icon.
- `alarms` — resume batch research if Chrome kills the service worker (1-minute alarm), and re-check watched accounts every 6 hours.
- `scripting` — run the signal-collection scripts on the page you asked about.
- `sidePanel` — display the brief in Chrome's side panel.
- `storage` — save your API key, model choice, seller profile, cached and saved briefs, batch queue state, scoring weights, and a one-time migration flag in chrome.storage.local.
- `tabs` — read the current tab's URL so the brief knows which site it's analyzing, and clean up captured headers when a tab closes.
- `unlimitedStorage` — let locally stored briefs and account snapshots grow past Chrome's default storage quota.
- `webRequest` — read main-frame response headers (e.g. server, x-powered-by) for tech detection.
- `<all_urls>` — collect signals from, and fetch, any company website you research. This covers the page you click on, and also background access you set up yourself: batch research over a list of domains and the 6-hourly re-checks of accounts you chose to watch. It is not click-only.
- Host `https://api.anthropic.com/*` — send page signals to Claude for the overview and talking points.
- Host `https://news.google.com/*` — fetch recent headlines via Google News RSS.
