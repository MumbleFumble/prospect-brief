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

**Privacy-first**

- No backend server. No analytics. No tracking.
- Your Anthropic API key stays in your browser (chrome.storage.local) and is only sent to api.anthropic.com.
- Page analysis runs locally; only the page signals you see are sent to the LLM.
- Briefs are cached per-domain for 24 hours to save API calls — clear anytime with Regenerate.

**Export**

- Copy as Markdown for your CRM or notes.
- Print / Save as PDF for a clean one-pager.

**Requirements**

- Bring your own Anthropic API key (set it in the extension options).

## Category

Productivity

## Screenshots (1280×800)

1. Side panel showing a completed brief (overview + talking points).
2. Tech stack section with confidence badges and evidence.
3. Recent news headlines.
4. Options page with API key field.

## Icon

See `public/icons/` (16/32/48/128 PNG).

## Permissions justification

- `activeTab` + `scripting` — read the current page's title, meta tags, scripts, and text to build the brief. Only when you click the icon.
- `tabs` — read the current tab's URL so the brief knows which site it's analyzing.
- `sidePanel` — display the brief.
- `storage` — save your API key, model choice, and cached briefs locally.
- `webRequest` — read main-frame response headers (e.g. server, x-powered-by) for tech detection.
- Host `https://api.anthropic.com/*` — send page signals to Claude for the overview and talking points.
- Host `https://news.google.com/*` — fetch recent headlines via Google News RSS.
