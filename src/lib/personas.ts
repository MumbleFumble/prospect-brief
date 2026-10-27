import type { HiringSignals } from './hiring';

/**
 * Personas (v0.3 element 4): who a sequence targets at an account.
 *
 * A standard role list, plus suggestions inferred from hiring signals —
 * a team hiring heavily in a department usually means someone there
 * owns budget for it.
 */

export const STANDARD_PERSONAS = [
  'Founder / CEO',
  'VP Sales',
  'Head of Growth',
  'VP Marketing',
  'RevOps / Sales Ops',
  'CTO / VP Engineering',
  'Head of Product',
  'Head of Customer Success',
] as const;

const DEPARTMENT_PERSONAS: { re: RegExp; personas: string[] }[] = [
  { re: /sales|revenue|account exec/i, personas: ['VP Sales'] },
  { re: /growth/i, personas: ['Head of Growth'] },
  { re: /marketing|brand|content|demand/i, personas: ['VP Marketing'] },
  { re: /revops|revenue operations|sales operations|business operations/i, personas: ['RevOps / Sales Ops'] },
  { re: /engineer|technical|data|infrastructure|platform/i, personas: ['CTO / VP Engineering'] },
  { re: /product|design/i, personas: ['Head of Product'] },
  { re: /customer|success|support|experience/i, personas: ['Head of Customer Success'] },
];

/** Personas suggested by the departments an account is hiring into. */
export function suggestPersonas(hiring: HiringSignals | null): string[] {
  if (!hiring) return [];
  const out: string[] = [];
  for (const dept of hiring.departments) {
    if (dept.count === 0) continue;
    for (const rule of DEPARTMENT_PERSONAS) {
      if (rule.re.test(dept.name)) {
        for (const p of rule.personas) if (!out.includes(p)) out.push(p);
      }
    }
  }
  return out;
}
