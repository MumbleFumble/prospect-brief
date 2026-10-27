import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCOUNT_STATUSES,
  accountToSavedBrief,
  deleteAccount,
  exportAccountsJson,
  latestSnapshot,
  listAccounts,
  migrateSavedBriefsIfNeeded,
  parseAccountsImport,
  putAccount,
  setNotes,
  setStatus,
  type AccountRecord,
  type AccountStatus,
} from '../../lib/accounts';
import { listSavedBriefs, type SavedBrief } from '../../lib/saved';
import { briefToCrmNote, savedBriefsToCsv } from '../../lib/export';

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function AccountCard({
  account,
  onChange,
}: {
  account: AccountRecord;
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
          {account.touches.map((t) => (
            <li key={t.id}>
              <small>
                {new Date(t.createdAt).toLocaleString()} · {t.kind}
                {t.persona ? ` to ${t.persona}` : ''} · {t.sentAt ? 'sent' : 'draft'}
                {t.subject ? ` · “${t.subject}”` : ''}
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

export default function AccountsView({ onBack }: { onBack: () => void }) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    await migrateSavedBriefsIfNeeded(listSavedBriefs).catch(() => 0);
    setAccounts(await listAccounts());
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
      {accounts.map((account) => (
        <AccountCard key={account.domain} account={account} onChange={reload} />
      ))}
    </main>
  );
}
