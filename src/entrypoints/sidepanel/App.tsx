import { useCallback, useEffect, useState } from 'react';
import { groupByCategory } from '../../detection/engine';
import type { Brief } from '../../lib/brief';
import { briefToMarkdown } from '../../lib/markdown';
import { companyQueryFor } from '../../lib/news';
import type {
  BriefResponse,
  CollectResponse,
  Detection,
  NewsItem,
  OutreachResponse,
  PageSignals,
} from '../../lib/types';
import type { OutreachDraft } from '../../lib/outreach';
import type { HiringSignals } from '../../lib/hiring';
import { getSettings } from '../../lib/settings';
import { findCompetitors, type CompetitorMatch } from '../../lib/competitors';
import {
  listSavedBriefs,
  deleteSavedBrief,
  clearSavedBriefs,
  type SavedBrief,
} from '../../lib/saved';
import { briefToCrmNote, savedBriefsToCsv } from '../../lib/export';

type Status =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      signals: PageSignals;
      detections: Detection[];
      news: NewsItem[];
      hiring: HiringSignals | null;
    }
  | { kind: 'error'; message: string };

type BriefStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; brief: Brief; cachedAt?: number }
  | { kind: 'error'; message: string };

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab.id;
}

const CONFIDENCE_STYLE: Record<Detection['confidence'], string> = {
  high: 'badge high',
  medium: 'badge medium',
  low: 'badge low',
};

function prettyCategory(cat: string): string {
  return cat
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function StackSection({ detections }: { detections: Detection[] }) {
  if (detections.length === 0) {
    return (
      <section>
        <h2>Likely tech stack</h2>
        <p>No technologies detected from page signals.</p>
      </section>
    );
  }
  const groups = groupByCategory(detections);
  return (
    <section>
      <h2>Likely tech stack</h2>
      {[...groups.entries()].map(([category, items]) => (
        <div key={category}>
          <h3>{prettyCategory(category)}</h3>
          <ul>
            {items.map((d) => (
              <li key={d.name}>
                <strong>{d.name}</strong>{' '}
                <span className={CONFIDENCE_STYLE[d.confidence]}>{d.confidence}</span>
                <ul>
                  {d.evidence.map((e, i) => (
                    <li key={i}>
                      <code>{e}</code>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function NewsSection({ news }: { news: NewsItem[] }) {
  return (
    <section>
      <h2>Recent news</h2>
      {news.length === 0 ? (
        <p>No recent headlines found.</p>
      ) : (
        <ul>
          {news.map((n, i) => (
            <li key={i}>
              <a href={n.link} target="_blank" rel="noreferrer">
                {n.title}
              </a>
              <br />
              <small>
                {n.source ?? 'Unknown source'}
                {n.pubDate ? ` — ${new Date(n.pubDate).toLocaleDateString()}` : ''}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CompetitorBanner({ detections }: { detections: Detection[] }) {
  const [matches, setMatches] = useState<CompetitorMatch[]>([]);

  useEffect(() => {
    getSettings()
      .then((s) => setMatches(findCompetitors(detections, s.sellerProfile.competitors)))
      .catch(() => setMatches([]));
  }, [detections]);

  if (matches.length === 0) return null;
  return (
    <section className="competitor-banner" role="alert">
      <p>
        <strong>Competitor in use:</strong> {matches.map((m) => m.detection.name).join(', ')}. This
        account is a displacement opportunity, not a greenfield pitch.
      </p>
    </section>
  );
}

function WhyNowSection({ hiring, news }: { hiring: HiringSignals | null; news: NewsItem[] }) {
  if (!hiring && news.length === 0) return null;
  return (
    <section>
      <h2>Why now</h2>
      {hiring ? (
        <>
          <p>
            <strong>{hiring.totalRoles} open roles</strong> on {hiring.board}
            {hiring.departments.length > 0 &&
              ` - hiring most in ${hiring.departments
                .slice(0, 3)
                .map((d) => `${d.name} (${d.count})`)
                .join(', ')}`}
            .
          </p>
          <ul>
            {hiring.topRoles.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
                {r.location ? ` - ${r.location}` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>No public job board found for this company.</p>
      )}
      {news.length > 0 && (
        <p>
          Latest headline: <em>{news[0].title}</em>
          {news[0].pubDate ? ` (${news[0].pubDate.slice(0, 10)})` : ''}
        </p>
      )}
    </section>
  );
}

type OutreachStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; draft: OutreachDraft }
  | { kind: 'error'; message: string };

function OutreachSection({
  company,
  brief,
  detections,
  news,
  hiring,
}: {
  company: string;
  brief: Brief;
  detections: Detection[];
  news: NewsItem[];
  hiring: HiringSignals | null;
}) {
  const [state, setState] = useState<OutreachStatus>({ kind: 'idle' });
  const [copied, setCopied] = useState<string | null>(null);

  async function draft() {
    setState({ kind: 'loading' });
    const res = (await chrome.runtime.sendMessage({
      type: 'GENERATE_OUTREACH',
      company,
      brief,
      detections,
      news,
      hiring,
    })) as OutreachResponse;
    if (res.ok) setState({ kind: 'ready', draft: res.draft });
    else setState({ kind: 'error', message: res.error });
  }

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <section className="no-print">
      <h2>Outreach draft</h2>
      {state.kind === 'idle' && <button onClick={draft}>Draft outreach</button>}
      {state.kind === 'loading' && <p>Drafting outreach...</p>}
      {state.kind === 'error' && (
        <p role="alert">
          Couldn&apos;t draft outreach. {state.message}{' '}
          <button className="link" onClick={draft}>
            Retry
          </button>
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          <p>
            <small>Leads with: {state.draft.signal}</small>
          </p>
          <h3>Email</h3>
          <p>
            <strong>{state.draft.emailSubject}</strong>
          </p>
          <p>{state.draft.emailBody}</p>
          <p>
            <button
              className="link"
              onClick={() =>
                copy('email', `Subject: ${state.draft.emailSubject}\n\n${state.draft.emailBody}`)
              }
            >
              {copied === 'email' ? 'Copied' : 'Copy email'}
            </button>
          </p>
          <h3>LinkedIn note</h3>
          <p>{state.draft.linkedInNote}</p>
          <p>
            <button className="link" onClick={() => copy('linkedin', state.draft.linkedInNote)}>
              {copied === 'linkedin' ? 'Copied' : 'Copy LinkedIn note'}
            </button>{' '}
            <button className="link" onClick={draft}>
              Redraft
            </button>
          </p>
        </>
      )}
    </section>
  );
}

function BriefSection({
  status,
  news,
  detections,
  onRegenerate,
}: {
  status: BriefStatus;
  news: NewsItem[];
  detections: Detection[];
  onRegenerate: () => void;
}) {
  return (
    <section>
      <h2>Brief</h2>
      {status.kind === 'idle' && <p>Preparing brief…</p>}
      {status.kind === 'loading' && <p>Generating overview and talking points…</p>}
      {status.kind === 'error' && (
        <div role="alert">
          <p>
            <strong>Couldn&apos;t generate the brief.</strong>
          </p>
          <p>{status.message}</p>
          {status.message.includes('API key') && (
            <p>
              <button onClick={() => chrome.runtime.openOptionsPage()}>Open options</button> to add
              your Anthropic key.
            </p>
          )}
        </div>
      )}
      {status.kind === 'ready' && (
        <>
          {status.cachedAt && (
            <p className="hint">From cache ({new Date(status.cachedAt).toLocaleString()})</p>
          )}
          <p>{status.brief.overview}</p>
          {status.brief.overviewRefs?.length > 0 && (
            <p>
              <small>
                Overview sources:{' '}
                {status.brief.overviewRefs.map((r) => (
                  <a key={r} href={news[r]?.link} target="_blank" rel="noreferrer">
                    [{r + 1}]{' '}
                  </a>
                ))}
              </small>
            </p>
          )}
          <h3>Talking points</h3>
          <ol>
            {status.brief.talkingPoints.map((t, i) => (
              <li key={i}>
                {t.point}
                {t.basis && t.basis !== 'news' && <small className="basis-tag"> ({t.basis})</small>}
                {t.sourceRefs.length > 0 && (
                  <small>
                    {' '}
                    — sources:{' '}
                    {t.sourceRefs.map((r) => (
                      <a key={r} href={news[r]?.link} target="_blank" rel="noreferrer">
                        [{r + 1}]
                      </a>
                    ))}
                  </small>
                )}
                {(t.stackRefs ?? []).length > 0 && (
                  <small>
                    {' '}
                    — tech:{' '}
                    {(t.stackRefs ?? []).map((r) => (
                      <span key={r}>[{detections[r]?.name ?? `S${r + 1}`}] </span>
                    ))}
                  </small>
                )}
              </li>
            ))}
          </ol>
          <p className="no-print">
            <button className="link" onClick={onRegenerate}>
              Regenerate
            </button>
          </p>
        </>
      )}
    </section>
  );
}

function SavedView({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<SavedBrief[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setList(await listSavedBriefs());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function copyNote(entry: SavedBrief) {
    await navigator.clipboard.writeText(briefToCrmNote(entry));
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function exportCsv() {
    const csv = savedBriefsToCsv(list);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prospect-briefs.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <h1>Saved briefs</h1>
      <p className="no-print">
        <button className="link" onClick={onBack}>
          Back to current page
        </button>
      </p>
      {list.length === 0 && <p>No saved briefs yet. Briefs are saved automatically.</p>}
      {list.length > 0 && (
        <>
          <p className="no-print">
            <button onClick={exportCsv}>Export CSV</button>{' '}
            <button
              className="link"
              onClick={async () => {
                await clearSavedBriefs();
                await reload();
              }}
            >
              Clear all
            </button>
          </p>
          {list.map((entry) => (
            <section key={entry.id}>
              <h2>{entry.company}</h2>
              <p>
                <small>
                  {new Date(entry.savedAt).toLocaleDateString()} -{' '}
                  <a href={entry.url} target="_blank" rel="noreferrer">
                    {entry.domain}
                  </a>
                  {entry.hiring ? ` - ${entry.hiring.totalRoles} open roles` : ''}
                </small>
              </p>
              <p>{entry.brief.overview}</p>
              <p className="no-print">
                <button className="link" onClick={() => copyNote(entry)}>
                  {copiedId === entry.id ? 'Copied' : 'Copy as CRM note'}
                </button>{' '}
                <button
                  className="link"
                  onClick={async () => {
                    await deleteSavedBrief(entry.id);
                    await reload();
                  }}
                >
                  Delete
                </button>
              </p>
            </section>
          ))}
        </>
      )}
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<'current' | 'saved'>('current');
  const [tab, setTab] = useState<'brief' | 'signals' | 'outreach'>('brief');
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [briefStatus, setBriefStatus] = useState<BriefStatus>({ kind: 'idle' });
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(
    async (
      signals: PageSignals,
      detections: Detection[],
      news: NewsItem[],
      hiring: HiringSignals | null,
    ) => {
      setBriefStatus({ kind: 'loading' });
      const briefRes = (await chrome.runtime.sendMessage({
        type: 'GENERATE_BRIEF',
        signals,
        detections,
        news,
        hiring,
      })) as BriefResponse;
      if (briefRes.ok) setBriefStatus({ kind: 'ready', brief: briefRes.brief });
      else setBriefStatus({ kind: 'error', message: briefRes.error });
    },
    [],
  );

  const regenerate = useCallback(async () => {
    if (status.kind !== 'ready') return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', url: status.signals.dom.url });
    await generate(status.signals, status.detections, status.news, status.hiring);
  }, [status, generate]);

  const copyMarkdown = useCallback(async () => {
    if (status.kind !== 'ready' || briefStatus.kind !== 'ready') return;
    const company = companyQueryFor(
      status.signals.dom.url,
      status.signals.dom.title,
      status.signals.dom.ogTags,
    );
    const md = briefToMarkdown(
      company,
      status.signals.dom.url,
      briefStatus.brief,
      status.detections,
      status.news,
    );
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [status, briefStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tabId = await getActiveTabId();
        const res = (await chrome.runtime.sendMessage({
          type: 'COLLECT_SIGNALS',
          tabId,
        })) as CollectResponse;
        if (cancelled) return;
        if (!res.ok) {
          setStatus({ kind: 'error', message: res.error });
          return;
        }
        setStatus({
          kind: 'ready',
          signals: res.signals,
          detections: res.detections,
          news: res.news,
          hiring: res.hiring,
        });

        // Use the cached brief if fresh; otherwise generate.
        if (res.cachedBrief) {
          setBriefStatus({ kind: 'ready', brief: res.cachedBrief, cachedAt: res.cachedAt });
        } else {
          await generate(res.signals, res.detections, res.news, res.hiring);
        }
      } catch (e) {
        if (!cancelled)
          setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generate]);

  if (view === 'saved') return <SavedView onBack={() => setView('current')} />;

  return (
    <main>
      <h1>Prospect Brief</h1>
      <p className="no-print">
        <button className="link" onClick={() => setView('saved')}>
          Saved briefs
        </button>
      </p>
      {status.kind === 'loading' && <p>Collecting page signals…</p>}
      {status.kind === 'error' && (
        <div role="alert">
          <p>
            <strong>Couldn&apos;t collect signals.</strong>
          </p>
          <p>{status.message}</p>
        </div>
      )}
      {status.kind === 'ready' && (
        <>
          <p>
            Brief for <code>{status.signals.dom.url}</code>{' '}
            <button className="link no-print" onClick={() => window.location.reload()}>
              Refresh
            </button>
          </p>
          {briefStatus.kind === 'ready' && (
            <p className="toolbar no-print">
              <button onClick={copyMarkdown}>{copied ? 'Copied ✓' : 'Copy as Markdown'}</button>{' '}
              <button onClick={() => window.print()}>Print / Save as PDF</button>
            </p>
          )}
          <CompetitorBanner detections={status.detections} />
          <nav className="tab-bar no-print" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'brief'}
              className={tab === 'brief' ? 'tab active' : 'tab'}
              onClick={() => setTab('brief')}
            >
              Brief
            </button>
            <button
              role="tab"
              aria-selected={tab === 'signals'}
              className={tab === 'signals' ? 'tab active' : 'tab'}
              onClick={() => setTab('signals')}
            >
              Signals
            </button>
            <button
              role="tab"
              aria-selected={tab === 'outreach'}
              className={tab === 'outreach' ? 'tab active' : 'tab'}
              onClick={() => setTab('outreach')}
            >
              Outreach
            </button>
          </nav>
          {tab === 'brief' && (
            <BriefSection
              status={briefStatus}
              news={status.news}
              detections={status.detections}
              onRegenerate={regenerate}
            />
          )}
          {tab === 'signals' && (
            <>
              <StackSection detections={status.detections} />
              <WhyNowSection hiring={status.hiring} news={status.news} />
              <NewsSection news={status.news} />
              <p className="no-print">
                <button className="link" onClick={() => setShowRaw((v) => !v)}>
                  {showRaw ? 'Hide' : 'Show'} raw signals
                </button>
              </p>
              {showRaw && <pre className="no-print">{JSON.stringify(status.signals, null, 2)}</pre>}
            </>
          )}
          {tab === 'outreach' &&
            (briefStatus.kind === 'ready' ? (
              <OutreachSection
                company={companyQueryFor(
                  status.signals.dom.url,
                  status.signals.dom.title,
                  status.signals.dom.ogTags,
                )}
                brief={briefStatus.brief}
                detections={status.detections}
                news={status.news}
                hiring={status.hiring}
              />
            ) : (
              <p>Generate the brief first, then draft outreach from it.</p>
            ))}
        </>
      )}
    </main>
  );
}
