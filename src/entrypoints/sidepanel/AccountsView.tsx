import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCOUNT_STATUSES,
  accountToSavedBrief,
  addTouch,
  deleteAccount,
  exportAccountsJson,
  latestSnapshot,
  listAccounts,
  markTouchSent,
  migrateSavedBriefsIfNeeded,
  parseAccountsImport,
  putAccount,
  setNotes,
  setStatus,
  type AccountRecord,
  type AccountStatus,
} from '../../lib/accounts';
import { STANDARD_PERSONAS, suggestPersonas } from '../../lib/personas';
import { pendingWatchEvents } from '../../lib/watch';
import { sequenceToTouches } from '../../lib/sequences';
import type { SequenceResponse } from '../../lib/types';
import { listSavedBriefs, type SavedBrief } from '../../lib/saved';
import { briefToCrmNote, savedBriefsToCsv } from '../../lib/export';
import {
  MAX_BATCH,
  batchProgress,
  estimateBatchCost,
  parseDomainList,
  type BatchState,
} from '../../lib/batch';
import { getSettings, type SellerProfile } from '../../lib/settings';
import {
  DEFAULT_WEIGHTS,
  getScoringWeights,
  saveScoringWeights,
  scoreAccount,
  type AccountScore,
  type ScoringWeights,
} from '../../lib/scoring';

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


function SequenceSection({
  account,
  onChange,
}: {
  account: AccountRecord;
  onChange: () => Promise<void>;
}) {
  const suggested = suggestPersonas(latestSnapshot(account)?.hiring ?? null);
  const [persona, setPersona] = useState<string>(suggested[0] ?? STANDARD_PERSONAS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const snap = latestSnapshot(account);

  async function generate() {
    if (!account.brief || !snap) return;
    setBusy(true);
    setError(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'GENERATE_SEQUENCE',
        company: account.company,
        persona,
        brief: account.brief,
        detections: snap.detections,
        news: snap.news,
        hiring: snap.hiring,
      })) as SequenceResponse;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      let next = account;
      for (const touch of sequenceToTouches(res.sequence, Date.now())) {
        next = addTouch(next, touch);
      }
      await putAccount(next);
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  async function copyTouch(id: string, body: string) {
    await navigator.clipboard.writeText(body);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <>
      <p className="no-print">
        <label>
          Persona{' '}
          <select value={persona} onChange={(e) => setPersona(e.target.value)}>
            {STANDARD_PERSONAS.map((p) => (
              <option key={p} value={p}>
                {p}
                {suggested.includes(p) ? ' (hiring)' : ''}
              </option>
            ))}
          </select>
        </label>{' '}
        <button onClick={() => void generate()} disabled={busy || !account.brief}>
          {busy ? 'Drafting…' : 'Generate 3-touch sequence'}
        </button>
      </p>
      {!account.brief && (
        <p>
          <small>Generate a brief first — sequences are built from its signals.</small>
        </p>
      )}
      {error && (
        <p role="alert">
          <small>{error}</small>
        </p>
      )}
      {account.touches.length > 0 && (
        <ol>
          {account.touches.map((t) => (
            <li key={t.id}>
              <small>
                {t.kind}
                {t.persona ? ` · ${t.persona}` : ''}
                {t.scheduledFor
                  ? ` · due ${new Date(t.scheduledFor).toLocaleDateString()}`
                  : ''}
                {' · '}
                {t.sentAt ? `sent ${new Date(t.sentAt).toLocaleDateString()}` : 'not sent'}
                {t.signal ? ` · signal: ${t.signal}` : ''}
              </small>
              {t.subject && (
                <div>
                  <small>
                    <strong>{t.subject}</strong>
                  </small>
                </div>
              )}
              <div>
                <small>{t.body}</small>
              </div>
              <span className="no-print">
                <button className="link" onClick={() => void copyTouch(t.id, t.body)}>
                  {copiedId === t.id ? 'Copied' : 'Copy'}
                </button>{' '}
                {!t.sentAt && (
                  <button
                    className="link"
                    onClick={async () => {
                      await putAccount(markTouchSent(account, t.id, Date.now()));
                      await onChange();
                    }}
                  >
                    Mark sent
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function AccountCard({
  account,
  score,
  onChange,
}: {
  account: AccountRecord;
  score: AccountScore;
  onChange: () => Promise<void>;
}) {
  const [notes, setNotesLocal] = useState(account.notes);
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const snap = latestSnapshot(account);
  const asSaved: SavedBrief | null = accountToSavedBrief(account);

  async function changeStatus(status: AccountStatus) {
    await putAccount(setStatus(account, status, Date.now()));
    await onChange();
  }

  async function saveNotes() {
    if (notes === account.notes) return;
    await putAccount(setNotes(account, notes, Date.now()));
    await onChange();
  }

  async function copyNote() {
    if (!asSaved) return;
    await navigator.clipboard.writeText(briefToCrmNote(asSaved));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section>
      <h2>{account.company}</h2>
      <p>
        <small>
          <a href={account.url} target="_blank" rel="noreferrer">
            {account.domain}
          </a>{' '}
          · updated {new Date(account.updatedAt).toLocaleDateString()}
          {snap?.hiring ? ` · ${snap.hiring.totalRoles} open roles` : ''}
          {snap?.detectionQuality === 'partial' ? ' · partial detection' : ''}
        </small>
      </p>
      <p className="no-print">
        <label>
          <input
            type="checkbox"
            checked={account.watched ?? false}
            onChange={async (e) => {
              await putAccount({ ...account, watched: e.target.checked });
              await onChange();
            }}
          />{' '}
          Watch for changes
        </label>
        {account.lastWatchCheckAt ? (
          <small> · last checked {new Date(account.lastWatchCheckAt).toLocaleDateString()}</small>
        ) : null}
        {pendingWatchEvents(account).length > 0 ? (
          <small> · {pendingWatchEvents(account).length} new signal(s) — see Today</small>
        ) : null}
      </p>
      <p className="no-print">
        <label>
          Status{' '}
          <select
            value={account.status}
            onChange={(e) => void changeStatus(e.target.value as AccountStatus)}
          >
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <small>
          <strong>Score {score.total}</strong>
        </small>
      </p>
      {score.components.length > 0 && (
        <ul>
          {score.components.map((c) => (
            <li key={c.label}>
              <small>
                {c.points > 0 ? `+${c.points}` : c.points} — {c.label}
              </small>
            </li>
          ))}
        </ul>
      )}
      {account.brief && <p>{account.brief.overview}</p>}
      <p className="no-print">
        <textarea
          aria-label={`Notes for ${account.company}`}
          placeholder="Notes…"
          value={notes}
          rows={2}
          style={{ width: '100%' }}
          onChange={(e) => setNotesLocal(e.target.value)}
          onBlur={() => void saveNotes()}
        />
      </p>
      <SequenceSection account={account} onChange={onChange} />
      <p>
        <small>
          {account.snapshots.length} snapshot{account.snapshots.length === 1 ? '' : 's'} ·{' '}
          {account.touches.length} touch{account.touches.length === 1 ? '' : 'es'} logged
        </small>{' '}
        <button className="link no-print" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? 'Hide history' : 'History'}
        </button>
      </p>
      {showHistory && (
        <ul>
          {[...account.snapshots].reverse().map((s) => (
            <li key={s.takenAt}>
              <small>
                {new Date(s.takenAt).toLocaleString()} · {s.detections.length} technologies ·{' '}
                {s.news.length} headlines · {s.hiring?.totalRoles ?? 0} roles · {s.detectionQuality}
              </small>
            </li>
          ))}
        </ul>
      )}
      <p className="no-print">
        {asSaved && (
          <>
            <button className="link" onClick={() => void copyNote()}>
              {copied ? 'Copied' : 'Copy as CRM note'}
            </button>{' '}
          </>
        )}
        <button
          className="link"
          onClick={async () => {
            await deleteAccount(account.domain);
            await onChange();
          }}
        >
          Delete
        </button>
      </p>
    </section>
  );
}

function BatchSection({ onBatchDone }: { onBatchDone: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-5');
  const [state, setState] = useState<BatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const lastDone = useRef(0);

  const domains = parseDomainList(text).slice(0, MAX_BATCH);
  const estimate = estimateBatchCost(domains.length, model);
  const progress = state ? batchProgress(state) : null;

  const poll = useCallback(async () => {
    const res = (await chrome.runtime.sendMessage({ type: 'GET_BATCH_STATE' })) as {
      ok: boolean;
      state: BatchState | null;
    };
    if (res.ok) {
      setState(res.state);
      const done = res.state ? batchProgress(res.state).done + batchProgress(res.state).partial : 0;
      if (done !== lastDone.current) {
        lastDone.current = done;
        await onBatchDone();
      }
    }
  }, [onBatchDone]);

  useEffect(() => {
    void getSettings().then((s) => setModel(s.model));
    void poll();
  }, [poll]);

  useEffect(() => {
    if (!progress?.active) return;
    const id = setInterval(() => void poll(), 2500);
    return () => clearInterval(id);
  }, [progress?.active, poll]);

  async function start() {
    setError(null);
    const res = (await chrome.runtime.sendMessage({ type: 'START_BATCH', domains })) as {
      ok: boolean;
      error?: string;
      state?: BatchState;
    };
    if (!res.ok) setError(res.error ?? 'Could not start the batch.');
    else {
      setState(res.state ?? null);
      setText('');
    }
  }

  async function cancel() {
    await chrome.runtime.sendMessage({ type: 'CANCEL_BATCH' });
    await poll();
  }

  return (
    <section>
      <h2>Batch research</h2>
      <p>
        <small>
          Paste domains (one per line, or a CSV export) and each is researched into the account
          store. Detection is partial — it reads the raw page HTML, so open a site later for a
          full rescan.
        </small>
      </p>
      <p className="no-print">
        <textarea
          aria-label="Domains to research"
          placeholder={'stripe.com\nlinear.app\nairbnb.com'}
          value={text}
          rows={4}
          style={{ width: '100%' }}
          onChange={(e) => setText(e.target.value)}
        />
      </p>
      <p className="no-print">
        <button className="link" onClick={() => csvRef.current?.click()}>
          Import CSV/TXT
        </button>
        <input
          ref={csvRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
            e.target.value = '';
          }}
        />
      </p>
      {domains.length > 0 && (
        <p>
          <small>
            {domains.length} domain{domains.length === 1 ? '' : 's'} · estimated cost $
            {estimate.estUsd.toFixed(2)} on your API key (range ${estimate.lowUsd.toFixed(2)}–$
            {estimate.highUsd.toFixed(2)})
            {estimate.pricingKnown ? '' : ' · approximate pricing'}
          </small>
        </p>
      )}
      <p className="no-print">
        <button onClick={() => void start()} disabled={domains.length === 0 || progress?.active}>
          Start batch
        </button>
      </p>
      {error && (
        <p role="alert">
          <small>{error}</small>
        </p>
      )}
      {state && progress && (
        <>
          <p>
            <small>
              Batch: {progress.done} done · {progress.partial} partial · {progress.errors} failed
              · {progress.remaining} remaining of {progress.total}
              {progress.active ? ' · running…' : ' · finished'}
            </small>{' '}
            {progress.active && (
              <button className="link no-print" onClick={() => void cancel()}>
                Cancel
              </button>
            )}
          </p>
          {state.items.some((i) => i.status === 'error') && (
            <ul>
              {state.items
                .filter((i) => i.status === 'error')
                .map((i) => (
                  <li key={i.domain}>
                    <small>
                      {i.domain}: {i.error}
                    </small>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}


const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  competitorDetected: 'Competitor in use',
  hiringActive: 'Hiring (any roles)',
  hiringVolume: 'Hiring volume (10+ roles)',
  hiringGrowth: 'Hiring growth between checks',
  newsFresh: 'Fresh news (14 days)',
  newsRecent: 'Recent news (45 days)',
  newsStale: 'Stale news penalty (90+ days)',
  stackDepth: 'Deep tech stack (8+)',
  icpKeyword: 'ICP keyword match (each, max 2)',
};

function WeightsEditor({ onSaved }: { onSaved: () => Promise<void> }) {
  const [weights, setWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void getScoringWeights().then(setWeights);
  }, []);

  async function save() {
    await saveScoringWeights(weights);
    await onSaved();
  }

  return (
    <section>
      <p className="no-print">
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? 'Hide scoring weights' : 'Scoring weights'}
        </button>
      </p>
      {open && (
        <>
          {(
            Object.keys(WEIGHT_LABELS) as (keyof ScoringWeights)[]
          ).map((k) => (
            <p key={k}>
              <label>
                {WEIGHT_LABELS[k]}{' '}
                <input
                  type="number"
                  value={weights[k]}
                  style={{ width: '4em' }}
                  onChange={(e) =>
                    setWeights({ ...weights, [k]: Number(e.target.value) || 0 })
                  }
                />
              </label>
            </p>
          ))}
          <p className="no-print">
            <button onClick={() => void save()}>Save weights</button>
          </p>
        </>
      )}
    </section>
  );
}

export default function AccountsView({ onBack }: { onBack: () => void }) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [weights, setWeightsState] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  const [sort, setSort] = useState<'score' | 'recent'>('score');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    await migrateSavedBriefsIfNeeded(listSavedBriefs).catch(() => 0);
    setAccounts(await listAccounts());
    const settings = await getSettings();
    setProfile(settings.sellerProfile);
    setWeightsState(await getScoringWeights());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function exportCsv() {
    const saved = accounts
      .map(accountToSavedBrief)
      .filter((s): s is SavedBrief => s !== null);
    download('prospect-briefs.csv', savedBriefsToCsv(saved), 'text/csv');
  }

  function exportJson() {
    download('prospect-brief-accounts.json', exportAccountsJson(accounts), 'application/json');
  }

  async function importJson(file: File) {
    setImportError(null);
    try {
      const imported = parseAccountsImport(await file.text());
      for (const rec of imported) {
        const existing = accounts.find((a) => a.domain === rec.domain);
        // Keep whichever record was updated more recently.
        if (!existing || rec.updatedAt >= existing.updatedAt) await putAccount(rec);
      }
      await reload();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main>
      <h1>Accounts</h1>
      <p className="no-print">
        <button className="link" onClick={onBack}>
          Back to current page
        </button>
      </p>
      <BatchSection onBatchDone={reload} />
      {accounts.length === 0 && (
        <p>No accounts yet. Generate a brief and the account is stored automatically.</p>
      )}
      {accounts.length > 0 && (
        <p className="no-print">
          <button onClick={exportCsv}>Export CSV</button>{' '}
          <button onClick={exportJson}>Export JSON</button>{' '}
          <button className="link" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
        </p>
      )}
      {importError && (
        <p role="alert">
          <small>Import failed: {importError}</small>
        </p>
      )}
      {accounts.length > 1 && (
        <p className="no-print">
          <label>
            Sort{' '}
            <select value={sort} onChange={(e) => setSort(e.target.value as 'score' | 'recent')}>
              <option value="score">Score (work these first)</option>
              <option value="recent">Recently updated</option>
            </select>
          </label>
        </p>
      )}
      <WeightsEditor onSaved={reload} />
      {accounts
        .map((account) => ({
          account,
          score: scoreAccount(account, profile, weights, Date.now()),
        }))
        .sort((a, b) =>
          sort === 'score' ? b.score.total - a.score.total : b.account.updatedAt - a.account.updatedAt,
        )
        .map(({ account, score }) => (
          <AccountCard key={account.domain} account={account} score={score} onChange={reload} />
        ))}
    </main>
  );
}
