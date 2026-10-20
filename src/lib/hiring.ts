/**
 * Hiring signals from public job-board APIs (step: hiring).
 *
 * Greenhouse, Lever, and Ashby all expose public JSON for job boards.
 * Open roles are a strong buying signal: team growth, priorities, and
 * tech stack (job descriptions name tools).
 *
 * Detection strategy:
 * 1. Scan page link hrefs for job-board URLs (most reliable).
 * 2. Fall back to the domain-derived slug (stripe.com -> "stripe").
 * All fetches are best-effort; null means "no board found".
 */
import type { PageSignals } from './types';

export type JobBoard = 'greenhouse' | 'lever' | 'ashby';

export interface JobPosting {
  title: string;
  department: string | null;
  location: string | null;
  url: string;
}

export interface HiringSignals {
  board: JobBoard;
  boardToken: string;
  totalRoles: number;
  /** Departments with open roles, sorted by count desc. */
  departments: { name: string; count: number }[];
  /** Up to 5 representative roles. */
  topRoles: JobPosting[];
}

const BOARD_PATTERNS: { board: JobBoard; re: RegExp }[] = [
  { board: 'greenhouse', re: /boards\.greenhouse\.io\/([a-z0-9_-]+)/i },
  { board: 'greenhouse', re: /greenhouse\.io\/([a-z0-9_-]+)\/jobs/i },
  { board: 'lever', re: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { board: 'ashby', re: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
];

/** Find a job board token from the page's links. */
export function findBoardInLinks(hrefs: string[]): { board: JobBoard; token: string } | null {
  for (const href of hrefs) {
    for (const { board, re } of BOARD_PATTERNS) {
      const m = href.match(re);
      if (m) return { board, token: m[1].toLowerCase() };
    }
  }
  return null;
}

/** Derive a likely board slug from the company domain (stripe.com -> stripe). */
export function slugFromDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    if (parts.length < 2) return null;
    const slug = parts[parts.length - 2];
    return slug && slug.length >= 2 ? slug.toLowerCase() : null;
  } catch {
    return null;
  }
}

function summarize(board: JobBoard, token: string, jobs: JobPosting[]): HiringSignals {
  const deptCounts = new Map<string, number>();
  for (const j of jobs) {
    if (j.department) deptCounts.set(j.department, (deptCounts.get(j.department) ?? 0) + 1);
  }
  const departments = [...deptCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  return {
    board,
    boardToken: token,
    totalRoles: jobs.length,
    departments,
    topRoles: jobs.slice(0, 5),
  };
}

async function fetchGreenhouse(token: string): Promise<HiringSignals | null> {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    jobs?: Array<{
      title: string;
      absolute_url: string;
      location?: { name?: string };
      departments?: Array<{ name?: string }>;
    }>;
  };
  if (!data.jobs || data.jobs.length === 0) return null;
  const jobs: JobPosting[] = data.jobs.map((j) => ({
    title: j.title,
    department: j.departments?.[0]?.name ?? null,
    location: j.location?.name ?? null,
    url: j.absolute_url,
  }));
  return summarize('greenhouse', token, jobs);
}

async function fetchLever(token: string): Promise<HiringSignals | null> {
  const res = await fetch(
    `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{
    text: string;
    hostedUrl: string;
    categories?: { department?: string; location?: string };
  }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const jobs: JobPosting[] = data.map((j) => ({
    title: j.text,
    department: j.categories?.department ?? null,
    location: j.categories?.location ?? null,
    url: j.hostedUrl,
  }));
  return summarize('lever', token, jobs);
}

async function fetchAshby(token: string): Promise<HiringSignals | null> {
  const res = await fetch(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    jobs?: Array<{
      title: string;
      department?: string;
      team?: string;
      location?: string;
      jobUrl: string;
    }>;
  };
  if (!data.jobs || data.jobs.length === 0) return null;
  const jobs: JobPosting[] = data.jobs.map((j) => ({
    title: j.title,
    department: j.department ?? j.team ?? null,
    location: j.location ?? null,
    url: j.jobUrl,
  }));
  return summarize('ashby', token, jobs);
}

const FETCHERS: Record<JobBoard, (token: string) => Promise<HiringSignals | null>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
};

/**
 * Fetch hiring signals for the company behind this page.
 * Tries the board found in page links first, then the domain slug
 * against each board. Returns null when nothing is found.
 */
export async function fetchHiringSignals(signals: PageSignals): Promise<HiringSignals | null> {
  const fromLinks = findBoardInLinks(signals.dom.linkHrefs);
  if (fromLinks) {
    const hit = await FETCHERS[fromLinks.board](fromLinks.token).catch(() => null);
    if (hit) return hit;
  }

  const slug = slugFromDomain(signals.dom.url);
  if (slug && (!fromLinks || fromLinks.token !== slug)) {
    for (const board of ['greenhouse', 'lever', 'ashby'] as JobBoard[]) {
      if (fromLinks && fromLinks.board === board && fromLinks.token === slug) continue;
      const hit = await FETCHERS[board](slug).catch(() => null);
      if (hit) return hit;
    }
  }
  return null;
}
