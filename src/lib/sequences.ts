import { z } from 'zod';
import type { Brief } from './brief';
import type { Detection, NewsItem } from './types';
import type { HiringSignals } from './hiring';
import type { SellerProfile } from './settings';
import type { TouchLogEntry } from './accounts';

/**
 * Follow-up sequences (v0.3 element 4).
 *
 * A 3-touch sequence per persona, each touch anchored on a DIFFERENT
 * signal so the sequence never repeats itself:
 *   day 1 — email on the strongest signal
 *   day 4 — LinkedIn note on a second signal
 *   day 9 — short email on a third signal or a graceful close
 * Touches are drafted only; the rep copies, sends, and marks them sent
 * by hand (no sending without a server/OAuth, deliberately).
 */

export const SequenceTouchSchema = z.object({
  dayOffset: z.number().int().min(1).max(30),
  kind: z.enum(['email', 'linkedin']),
  subject: z.string().max(120).nullable(),
  body: z.string().min(1).max(1500),
  /** The signal this touch is anchored on. */
  signal: z.string().min(1).max(200),
});

export const SequenceSchema = z.object({
  persona: z.string().min(1).max(80),
  touches: z.array(SequenceTouchSchema).length(3),
});

export type SequenceTouch = z.infer<typeof SequenceTouchSchema>;
export type Sequence = z.infer<typeof SequenceSchema>;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1500;

export function buildSequencePrompt(
  company: string,
  persona: string,
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

  return `You write a 3-touch cold outreach sequence for a sales rep targeting the ${persona} at ${company}.

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
- Exactly 3 touches, each anchored on a DIFFERENT signal from the material above. Name the anchor in "signal" for each touch. Never reuse the same signal twice.
- Touch 1 (dayOffset 1, email): the strongest signal. 3 sentences max: specific reference to the signal, connection to the seller's value for a ${persona}, soft question CTA. Include a subject (max 120 chars).
- Touch 2 (dayOffset 4, linkedin): a second signal, written for the same persona. 1-2 sentences, body under 300 characters, no links, subject null.
- Touch 3 (dayOffset 9, email): a third signal if one remains, otherwise a short graceful close that leaves the door open. 2 sentences max. NEVER write "just following up" or "bumping this". Include a subject.
- Write for the persona's concerns: a ${persona} cares about their own remit, not the whole company.
- Only use facts present above. Do NOT invent names, funding, metrics, or personal details.
- Sound like a person, not a template. No "I hope this email finds you well", no "synergy", no exclamation marks.

Respond with ONLY a JSON object matching this shape:
{
  "persona": "${persona}",
  "touches": [
    { "dayOffset": 1, "kind": "email", "subject": "string", "body": "string", "signal": "string" },
    { "dayOffset": 4, "kind": "linkedin", "subject": null, "body": "string", "signal": "string" },
    { "dayOffset": 9, "kind": "email", "subject": "string", "body": "string", "signal": "string" }
  ]
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
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('Anthropic API returned no text.');
  return text;
}

export function parseSequence(raw: string): Sequence {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Sequence response was not JSON.');
  return SequenceSchema.parse(JSON.parse(raw.slice(start, end + 1)));
}

export async function generateSequence(
  apiKey: string,
  model: string,
  company: string,
  persona: string,
  brief: Brief,
  detections: Detection[],
  news: NewsItem[],
  hiring: HiringSignals | null,
  seller: SellerProfile | null,
): Promise<Sequence> {
  if (!apiKey) throw new Error('No Anthropic API key set. Open the extension options to add one.');
  const prompt = buildSequencePrompt(company, persona, brief, detections, news, hiring, seller);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callAnthropic(apiKey, model, prompt);
      return parseSequence(raw);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Convert a generated sequence into touch log entries scheduled by day offset. */
export function sequenceToTouches(sequence: Sequence, now: number): TouchLogEntry[] {
  return sequence.touches.map((t, i) => ({
    id: `touch:${now}:${i}`,
    kind: t.kind,
    persona: sequence.persona,
    subject: t.subject,
    body: t.body,
    signal: t.signal,
    createdAt: now,
    sentAt: null,
    scheduledFor: now + Math.max(0, t.dayOffset - 1) * 86_400_000,
  }));
}
