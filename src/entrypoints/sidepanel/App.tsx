import { useEffect, useState } from 'react';
import { groupByCategory } from '../../detection/engine';
import type { Brief } from '../../lib/brief';
import type {
  BriefResponse,
  CollectResponse,
  Detection,
  NewsItem,
  PageSignals,
} from '../../lib/types';

type Status =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      signals: PageSignals;
      detections: Detection[];
      news: NewsItem[];
    }
  | { kind: 'error'; message: string };

type BriefStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; brief: Brief }
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

function BriefSection({ status, news }: { status: BriefStatus; news: NewsItem[] }) {
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
        </>
      )}
    </section>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [briefStatus, setBriefStatus] = useState<BriefStatus>({ kind: 'idle' });
  const [showRaw, setShowRaw] = useState(false);

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

        // Stage 2: generate the brief (stack + news already visible).
        setBriefStatus({ kind: 'loading' });
        const briefRes = (await chrome.runtime.sendMessage({
          type: 'GENERATE_BRIEF',
          signals: res.signals,
          detections: res.detections,
          news: res.news,
        })) as BriefResponse;
        if (cancelled) return;
        if (briefRes.ok) setBriefStatus({ kind: 'ready', brief: briefRes.brief });
        else setBriefStatus({ kind: 'error', message: briefRes.error });
      } catch (e) {
        if (!cancelled)
          setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          <BriefSection status={briefStatus} news={status.news} />
          <StackSection detections={status.detections} />
          <NewsSection news={status.news} />
          <button onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'Hide' : 'Show'} raw signals
          </button>
          {showRaw && <pre>{JSON.stringify(status.signals, null, 2)}</pre>}
        </>
      )}
    </main>
  );
}
