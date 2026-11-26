import { z } from 'zod';
import {
  BRIEF_MAX_OUTPUT_TOKENS,
  BRIEF_MAX_TOTAL_TOKENS,
  BriefSchema,
  buildPromptContext,
  callAnthropic,
  CURRENT_BRIEF_SCHEMA_VERSION,
  estimateTokens,
  toStructuredOutputSchema,
  type Brief,
} from './brief';
import { domainFor } from './cache';
import { diffAgainstSavedBrief } from './diff';
import type { HiringSignals } from './hiring';
import { companyQueryFor } from './news';
import type { SavedBrief } from './saved';
import type { SellerProfile, Settings } from './settings';
import type { BriefResponse, Detection, NewsItem, PageSignals } from './types';

/**
 * Per-section regenerate (v0.8 step 1a, library layer).
 *
 * Given an existing brief and ONE section, produce a NEW brief
 * object with only that section regenerated from a section-scoped
 * prompt; every other section is carried over deep-equal and the
 * input brief is never mutated. No persistence here — saving
 * stays the caller's existing flow.
 *
 * Prompt-context choice (declared): the rest of the brief is NOT
 * included in the prompt. The section is regenerated from the
 * same signals with the same grounding rules as full generation;
 * including the sibling sections would add their full text to
 * every section prompt and break the cost property below.
 *
 * Cost discipline: a section prompt carries the same signal
 * context as the full prompt but only ONE section's rules, so
 * its estimate is strictly below the full generation's for the
 * same signals (pinned by test). The inc-021 prompt-over-ceiling
 * guard applies unchanged (BRIEF_MAX_TOTAL_TOKENS).
 *
 * Outcome surfacing: on success returns { brief, stopReason };
 * on failure THROWS an Error whose message carries the named
 * failure(s) ('prompt-over-ceiling: …', 'Invalid section
 * response: <named failures>', or the API error) — exactly the
 * shape classifyRunOutcome consumes via { error }, so the UI
 * step can classify a section regeneration like any other run.
 * A failed regeneration produces NO new brief, never a
 * silently-kept-old-section result disguised as success.
 */

export type BriefSectionKey = 'overview' | 'talkingPoints' | 'risks' | 'opportunities';

/** The zod response schema for each section, picked from BriefSchema. */
export const SECTION_RESPONSE_SCHEMAS = {
  overview: z.object({
    overview: BriefSchema.shape.overview,
    overviewRefs: BriefSchema.shape.overviewRefs,
    overviewStackRefs: BriefSchema.shape.overviewStackRefs,
    overviewBasis: BriefSchema.shape.overviewBasis,
  }),
  talkingPoints: z.object({ talkingPoints: BriefSchema.shape.talkingPoints }),
  risks: z.object({ risks: BriefSchema.shape.risks }),
  opportunities: z.object({ opportunities: BriefSchema.shape.opportunities }),
} as const;

/**
 * Structured-output JSON schemas for the section requests,
 * DERIVED from the zod schemas above exactly as BRIEF_JSON_SCHEMA
 * is derived from BriefSchema (inc-017) — never hand-written, so
 * they cannot drift from the validation schemas.
 */
export const SECTION_JSON_SCHEMAS: Record<BriefSectionKey, Record<string, unknown>> = {
  overview: toStructuredOutputSchema(
    z.toJSONSchema(SECTION_RESPONSE_SCHEMAS.overview),
  ) as Record<string, unknown>,
  talkingPoints: toStructuredOutputSchema(
    z.toJSONSchema(SECTION_RESPONSE_SCHEMAS.talkingPoints),
  ) as Record<string, unknown>,
  risks: toStructuredOutputSchema(z.toJSONSchema(SECTION_RESPONSE_SCHEMAS.risks)) as Record<
    string,
    unknown
  >,
  opportunities: toStructuredOutputSchema(
    z.toJSONSchema(SECTION_RESPONSE_SCHEMAS.opportunities),
  ) as Record<string, unknown>,
};

const GROUNDING_RULE =
  '- GROUNDING: For each item, set "basis" to where the claim comes from: "news" (a headline - include its index in sourceRefs), "stack" (a detected technology - include its [S#] index in stackRefs), "site" (the company\'s own website text), "hiring" (an open role or hiring pattern from HIRING SIGNALS), or "inference" (your own reasoning, not directly grounded). Never claim a basis you cannot support.';

const SECTION_RULES: Record<BriefSectionKey, (seller: SellerProfile | null) => string[]> = {
  overview: () => [
    '- The overview may only cite headlines or detected technologies that actually support it; put supporting headline indexes in overviewRefs and supporting tech-stack [S#] indexes in overviewStackRefs (both empty if none apply), and set overviewBasis to where the overview\'s claims mainly come from, using the same basis definitions as for talking points.',
    '- Keep the overview to 3-4 sentences.',
  ],
  talkingPoints: (seller) => [
    GROUNDING_RULE,
    seller && seller.whatYouSell.trim()
      ? "- Every talking point must connect one of the seller's value props to a specific observed signal (tech stack item, headline, or site fact). Lead with the prospect's situation, then the relevant value prop."
      : '- Every talking point must reference at least one headline by its [index] in sourceRefs.',
    '- Keep each talking point to 1-2 sentences.',
  ],
  risks: () => [
    GROUNDING_RULE,
    '- RISKS: List watch-outs about this prospect that the material above actually supports (e.g. layoffs, a hiring freeze, churn signals, a tech mismatch) in risks. For each risk, cite supporting headline indexes in sourceRefs and supporting tech-stack [S#] indexes in stackRefs, and set basis honestly using the same basis definitions as for talking points. If nothing in the material supports a risk, return an empty risks array rather than inventing one.',
  ],
  opportunities: () => [
    GROUNDING_RULE,
    '- OPPORTUNITIES: List positive openings at this prospect that the material above actually supports (e.g. expansion, funding, new leadership, a hiring surge, a tech-stack change creating a fit) in opportunities. For each opportunity, cite supporting headline indexes in sourceRefs and supporting tech-stack [S#] indexes in stackRefs, and set basis honestly using the same basis definitions as for talking points. If nothing in the material supports an opening, return an empty opportunities array rather than inventing one.',
  ],
};

const SECTION_LABEL: Record<BriefSectionKey, string> = {
  overview: 'overview (with its overviewRefs, overviewStackRefs and overviewBasis)',
  talkingPoints: 'talking points',
  risks: 'risks',
  opportunities: 'opportunities',
};

/** Build the section-scoped prompt: full signal context, one section's rules. */
export function buildSectionPrompt(
  section: BriefSectionKey,
  signals: PageSignals,
  detections: Detection[],
  news: NewsItem[],
  seller: SellerProfile | null = null,
  hiring: HiringSignals | null = null,
): string {
  const context = buildPromptContext(signals, detections, news, seller, hiring);
  return `${context}TASK
Regenerate ONLY the ${SECTION_LABEL[section]} section of this brief, from the material above. Do not return any other section.

RULES
- Only state facts supported by the website text, tech stack, or headlines above. Do NOT invent funding rounds, employee counts, revenue, or partnerships.
- If a signal is absent (no news, no relevant tech), leave the point out rather than inventing one. Prefer "not found" over guessing.
- If the headlines don't support a claim, don't make it.
${SECTION_RULES[section](seller).join('\n')}`;
}

/** Token estimate for one section regeneration (inc-021 pattern). */
export function estimateSectionRegeneration(
  section: BriefSectionKey,
  signals: PageSignals,
  detections: Detection[],
  news: NewsItem[],
  seller: SellerProfile | null = null,
  hiring: HiringSignals | null = null,
): number {
  return (
    estimateTokens(buildSectionPrompt(section, signals, detections, news, seller, hiring)) +
    BRIEF_MAX_OUTPUT_TOKENS
  );
}

/* ------------------------------------------------------------------ */
/* Section response validation (named failures, as validateBriefResponse) */
/* ------------------------------------------------------------------ */

export interface SectionValidationResult {
  valid: boolean;
  /** The parsed section payload when valid; null otherwise. */
  value: Record<string, unknown> | null;
  /** Named failure reasons, in check order, de-duplicated. */
  failures: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRefArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((ref) => typeof ref === 'number' && Number.isInteger(ref) && ref >= 0)
  );
}

/**
 * Validate one raw section response with the same named-failure
 * discipline as validateBriefResponse: invalid-json,
 * not-an-object, invalid-schema-version (when the payload
 * carries the field), the section's own named checks (missing /
 * empty / wrong-type, ref shapes named per section), and the
 * schema residual path for anything else.
 */
export function validateSectionResponse(
  section: BriefSectionKey,
  raw: string,
): SectionValidationResult {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { valid: false, value: null, failures: ['invalid-json'] };
  }
  if (!isPlainObject(parsed)) {
    return { valid: false, value: null, failures: ['not-an-object'] };
  }

  const failures: string[] = [];
  const push = (reason: string) => {
    if (!failures.includes(reason)) failures.push(reason);
  };

  if (
    parsed.schemaVersion !== undefined &&
    parsed.schemaVersion !== 1 &&
    parsed.schemaVersion !== 2
  ) {
    push('invalid-schema-version');
  }

  if (section === 'overview') {
    if (parsed.overview === undefined) push('missing-overview');
    else if (typeof parsed.overview !== 'string') push('overview-wrong-type');
    else if (parsed.overview.length === 0) push('empty-overview');
    if (parsed.overviewRefs !== undefined && !isRefArray(parsed.overviewRefs)) {
      push('invalid-ref-shape:overviewRefs');
    }
    if (parsed.overviewStackRefs !== undefined && !isRefArray(parsed.overviewStackRefs)) {
      push('invalid-ref-shape:overviewStackRefs');
    }
  } else if (section === 'talkingPoints') {
    if (parsed.talkingPoints === undefined) push('missing-talking-points');
    else if (!Array.isArray(parsed.talkingPoints)) push('talking-points-wrong-type');
    else {
      if (parsed.talkingPoints.length === 0) push('empty-talking-points');
      if (parsed.talkingPoints.length > 8) push('too-many-talking-points');
      for (const point of parsed.talkingPoints) {
        if (!isPlainObject(point)) {
          push('talking-point-wrong-type');
          continue;
        }
        if (point.point === undefined) push('missing-talking-point-text');
        else if (typeof point.point !== 'string') push('talking-point-text-wrong-type');
        else if (point.point.length === 0) push('empty-talking-point-text');
        if (point.sourceRefs === undefined) push('missing-source-refs');
        else if (!isRefArray(point.sourceRefs)) push('invalid-ref-shape:sourceRefs');
        if (point.stackRefs !== undefined && !isRefArray(point.stackRefs)) {
          push('invalid-ref-shape:stackRefs');
        }
      }
    }
  } else {
    // risks / opportunities: named ref-shape checks, mirroring
    // validateBriefResponse; other malformations fall through
    // to the schema path.
    const items = parsed[section];
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!isPlainObject(item)) continue;
        if (item.sourceRefs !== undefined && !isRefArray(item.sourceRefs)) {
          push(`invalid-ref-shape:${section}.sourceRefs`);
        }
        if (item.stackRefs !== undefined && !isRefArray(item.stackRefs)) {
          push(`invalid-ref-shape:${section}.stackRefs`);
        }
      }
    }
  }

  if (failures.length > 0) return { valid: false, value: null, failures };

  const result = SECTION_RESPONSE_SCHEMAS[section].safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      push(`schema:${issue.path.join('.') || 'root'}:${issue.code}`);
    }
    return { valid: false, value: null, failures };
  }
  return { valid: true, value: result.data as Record<string, unknown>, failures: [] };
}

/* ------------------------------------------------------------------ */
/* Regenerate                                                          */
/* ------------------------------------------------------------------ */

export interface SectionRegeneration {
  brief: Brief;
  stopReason: string | null;
}

/**
 * Regenerate ONE section of an existing brief. Returns a NEW
 * brief object: the regenerated section replaced, every other
 * section deep-equal to the input, schemaVersion stamped 2
 * (regenerating a stored v1 brief upgrades it). The input brief
 * is never mutated. Retries once on an invalid response, like
 * full generation; a still-invalid response throws with the
 * named failures and produces no brief.
 */
export async function regenerateBriefSection(
  apiKey: string,
  model: string,
  existing: Brief,
  section: BriefSectionKey,
  signals: PageSignals,
  detections: Detection[],
  news: NewsItem[],
  seller: SellerProfile | null = null,
  hiring: HiringSignals | null = null,
): Promise<SectionRegeneration> {
  if (!apiKey) throw new Error('No Anthropic API key set. Open the extension options to add one.');
  const prompt = buildSectionPrompt(section, signals, detections, news, seller, hiring);
  const promptTokens = estimateTokens(prompt);
  if (promptTokens + BRIEF_MAX_OUTPUT_TOKENS > BRIEF_MAX_TOTAL_TOKENS) {
    throw new Error(
      `prompt-over-ceiling: assembled section prompt is ~${promptTokens} tokens; with the ${BRIEF_MAX_OUTPUT_TOKENS}-token output ceiling it exceeds the ${BRIEF_MAX_TOTAL_TOKENS}-token total ceiling. No API call was made.`,
    );
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text, stopReason } = await callAnthropic(
        apiKey,
        model,
        prompt,
        SECTION_JSON_SCHEMAS[section],
      );
      const validation = validateSectionResponse(section, text);
      if (!validation.valid || !validation.value) {
        throw new Error(`Invalid section response: ${validation.failures.join(', ')}`);
      }
      const next = structuredClone(existing);
      Object.assign(next, validation.value);
      next.schemaVersion = CURRENT_BRIEF_SCHEMA_VERSION;
      return { brief: next, stopReason };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/* ------------------------------------------------------------------ */
/* Background-message orchestration (inc-032)                          */
/* ------------------------------------------------------------------ */

/** The REGENERATE_SECTION message payload (types.ts CollectRequest). */
export interface SectionRegenRequest {
  brief: Brief;
  section: BriefSectionKey;
  signals: PageSignals;
  detections: Detection[];
  news: NewsItem[];
  hiring: HiringSignals | null;
}

/** What runSectionRegeneration needs from the background worker. */
export interface SectionRegenDeps {
  getSettings: () => Promise<Settings>;
  regenerate: typeof regenerateBriefSection;
  listSaved: () => Promise<SavedBrief[]>;
  /**
   * Persist a freshly generated brief exactly as GENERATE_BRIEF
   * does (cache + saved history + account upsert, best-effort
   * inside). Called ONLY on success, after the diff is captured.
   */
  persist: (entry: {
    domain: string;
    company: string;
    url: string;
    brief: Brief;
    signals: PageSignals;
    detections: Detection[];
    news: NewsItem[];
    hiring: HiringSignals | null;
  }) => Promise<void>;
}

/**
 * The REGENERATE_SECTION handler logic, factored out of
 * background.ts so it is testable (the batch-engine precedent).
 * Mirrors GENERATE_BRIEF: on success the diff against the
 * previously saved brief is captured BEFORE persistence replaces
 * it, the new brief is persisted through the same flow, and the
 * response is the shared BriefResponse shape. On failure the
 * response carries the named error and NOTHING is persisted —
 * the diff is not even captured.
 */
export async function runSectionRegeneration(
  msg: SectionRegenRequest,
  deps: SectionRegenDeps,
): Promise<BriefResponse> {
  try {
    const { apiKey, model, sellerProfile } = await deps.getSettings();
    const { brief } = await deps.regenerate(
      apiKey,
      model,
      msg.brief,
      msg.section,
      msg.signals,
      msg.detections,
      msg.news,
      sellerProfile,
      msg.hiring,
    );
    const domain = domainFor(msg.signals.dom.url);
    const changes = await diffAgainstSavedBrief(domain, brief, deps.listSaved).catch(() => null);
    const company = companyQueryFor(msg.signals.dom.url, msg.signals.dom.title, msg.signals.dom.ogTags);
    await deps.persist({
      domain,
      company,
      url: msg.signals.dom.url,
      brief,
      signals: msg.signals,
      detections: msg.detections,
      news: msg.news,
      hiring: msg.hiring,
    });
    return { ok: true, brief, changes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
