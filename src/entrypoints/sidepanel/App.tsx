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
  PageSignals,
} from '../../lib/types';

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; signals: PageSignals; detections: Detection[]; news: NewsItem[] }
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

function BriefSection({
  status,
  news,
  onRegenerate,
}: {
  status: BriefStatus;
  news: NewsItem[];
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
          <h3>Talking points</h3>
          <ol>
            {status.brief.talkingPoints.map((t, i) => (
              <li key={i}>
                {t.point}
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

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [briefStatus, setBriefStatus] = useState<BriefStatus>({ kind: 'idle' });
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(
    async (signals: PageSignals, detections: Detection[], news: NewsItem[]) => {
      setBriefStatus({ kind: 'loading' });
      const briefRes = (await chrome.runtime.sendMessage({
        type: 'GENERATE_BRIEF',
        signals,
        detections,
        news,
      })) as BriefResponse;
      if (briefRes.ok) setBriefStatus({ kind: 'ready', brief: briefRes.brief });
      else setBriefStatus({ kind: 'error', message: briefRes.error });
    },
    [],
  );

  const regenerate = useCallback(async () => {
    if (status.kind !== 'ready') return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', url: status.signals.dom.url });
    await generate(status.signals, status.detections, status.news);
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
        });

        // Use the cached brief if fresh; otherwise generate.
        if (res.cachedBrief) {
          setBriefStatus({ kind: 'ready', brief: res.cachedBrief, cachedAt: res.cachedAt });
        } else {
          await generate(res.signals, res.detections, res.news);
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

  return (
    <main>
      <h1>Prospect Brief</h1>
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
            Brief for <code>{status.signals.dom.url}</code>
          </p>
          {briefStatus.kind === 'ready' && (
            <p className="toolbar no-print">
              <button onClick={copyMarkdown}>{copied ? 'Copied ✓' : 'Copy as Markdown'}</button>{' '}
              <button onClick={() => window.print()}>Print / Save as PDF</button>
            </p>
          )}
          <BriefSection status={briefStatus} news={status.news} onRegenerate={regenerate} />
          <StackSection detections={status.detections} />
          <NewsSection news={status.news} />
          <p className="no-print">
            <button className="link" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'Hide' : 'Show'} raw signals
            </button>
          </p>
          {showRaw && <pre className="no-print">{JSON.stringify(status.signals, null, 2)}</pre>}
        </>
      )}
    </main>
  );
}
