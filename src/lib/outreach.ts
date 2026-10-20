import { z } from 'zod';
import type { Brief } from './brief';
import type { Detection, NewsItem } from './types';
import type { SellerProfile } from './settings';
import type { HiringSignals } from './hiring';

/**
 * Outreach draft generation.
 *
 * A brief is an intermediate step; what a rep needs is the first message.
 * This generates a short email + LinkedIn note grounded in the brief's
 * strongest signal (most-cited news, hiring pattern, or key tech).
 */

export const OutreachSchema = z.object({
  /** The signal the draft leads with, in a few words. */
  signal: z.string().min(1),
  emailSubject: z.string().min(1).max(120),
  /** ~3 sentences. */
  emailBody: z.string().min(1).max(1200),
  /** LinkedIn connection note, max 300 chars. */
  linkedInNote: z.string().min(1).max(300),
});

export type OutreachDraft = z.infer<typeof OutreachSchema>;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 700;

export function buildOutreachPrompt(
  company: string,
  brief: Brief,
  detections: Detection[],
  news: NewsItem[],
  hiring: HiringSignals | null,
  seller: SellerProfile | null,
): string {
  const points = brief.talkingPoints.map((t, i) => `${i + 1}. [${t.basis}] ${t.point}`).join('\n');
  const stack = detections
    .slice(0, 8)
    .map((d) => d.name)
    .join(', ');
  const headlines = news.map((n, i) => `[${i}] ${n.title}`).join('\n');
  const hiringLine = hiring
    ? `${hiring.totalRoles} open roles; top departments: ${hiring.departments
        .slice(0, 3)
        .map((d) => `${d.name} (${d.count})`)
        .join(', ')}`
    : '(none found)';
  const sellerLine =
    seller && seller.whatYouSell.trim()
      ? `The rep sells: ${seller.whatYouSell}. Value props: ${seller.valueProps.join('; ') || '(none)'}. Ideal customer: ${seller.idealCustomer || '(unspecified)'}.`
      : 'The rep has not specified what they sell; keep the value connection generic and focus on the signal.';

  return `You write cold outreach for a sales rep. Using the brief below, draft the first message to a prospect at ${company}.

COMPANY OVERVIEW
${brief.overview}

TALKING POINTS (with grounding basis)
${points || '(none)'}

TECH STACK: ${stack || '(none detected)'}
NEWS HEADLINES
${headlines || '(none)'}
HIRING: ${hiringLine}

SELLER
${sellerLine}

RULES
- Pick the SINGLE strongest signal (a specific headline, a hiring pattern, or a notable technology) and lead with it. Name it in "signal".
- Email: exactly 3 sentences. Sentence 1 references the signal specifically (no generic flattery). Sentence 2 connects it to the seller's value. Sentence 3 is a soft call to action (a question, not a meeting demand).
- LinkedIn note: 1-2 sentences, under 300 characters, references the same signal. No links.
- Only use facts present above. Do NOT invent names, titles, funding, or metrics.
- Sound like a person, not a template. No "I hope this email finds you well", no "synergy", no exclamation marks.

Respond with ONLY a JSON object matching this shape:
{
  "signal": "string",
  "emailSubject": "string",
  "emailBody": "string",
  "linkedInNote": "string"
}`;
}

async function callAnthropic(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API error: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Anthropic returned no text content.');
  return text;
}

function parseOutreach(raw: string): OutreachDraft {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return OutreachSchema.parse(JSON.parse(cleaned));
}

export async function generateOutreach(
  apiKey: string,
  model: string,
  company: string,
  brief: Brief,
  detections: Detection[],
  news: NewsItem[],
  hiring: HiringSignals | null,
  seller: SellerProfile | null,
): Promise<OutreachDraft> {
  if (!apiKey) throw new Error('No Anthropic API key set. Open the extension options to add one.');
  const prompt = buildOutreachPrompt(company, brief, detections, news, hiring, seller);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callAnthropic(apiKey, model, prompt);
      return parseOutreach(raw);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
