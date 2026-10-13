import { useEffect, useState } from 'react';
import type { CollectResponse, PageSignals } from '../../lib/types';

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; signals: PageSignals }
  | { kind: 'error'; message: string };

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab.id;
}

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

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
        if (res.ok) setStatus({ kind: 'ready', signals: res.signals });
        else setStatus({ kind: 'error', message: res.error });
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
            Raw signals from <code>{status.signals.dom.url}</code> (step 2 — detection, news,
            and brief generation land in steps 3–5).
          </p>
          <pre>{JSON.stringify(status.signals, null, 2)}</pre>
        </>
      )}
    </main>
  );
}
