import { useCallback, useEffect, useState } from 'react';
import {
  addTouch,
  latestSnapshot,
  listAccounts,
  markTouchSent,
  migrateSavedBriefsIfNeeded,
  putAccount,
  type AccountRecord,
} from '../../lib/accounts';
import { listSavedBriefs } from '../../lib/saved';
import { getSettings, type SellerProfile } from '../../lib/settings';
import { getScoringWeights, scoreAccount, type ScoringWeights, DEFAULT_WEIGHTS } from '../../lib/scoring';
import { pendingWatchEvents } from '../../lib/watch';
import type { OutreachResponse } from '../../lib/types';

/**
 * Today (v0.3 home view): where the pipeline elements meet.
 * New signals from Watch, touches due from Sequences, and the top
 * accounts from Scoring. One screen to open in the morning.
 */
export default function TodayView({
  onBack,
  onOpenAccounts,
}: {
  onBack: () => void;
  onOpenAccounts: () => void;
}) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [weights, setWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    await migrateSavedBriefsIfNeeded(listSavedBriefs).catch(() => 0);
    setAccounts(await listAccounts());
    const settings = await getSettings();
    setProfile(settings.sellerProfile);
    setWeights(await getScoringWeights());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const now = Date.now();
  const withEvents = accounts.filter((a) => pendingWatchEvents(a).length > 0);
  const dueTouches = accounts.flatMap((account) =>
    account.touches
      .filter((t) => !t.sentAt && t.scheduledFor !== undefined && t.scheduledFor <= now)
      .map((touch) => ({ account, touch })),
  );
  const topAccounts = accounts
    .filter((a) => a.status === 'researching')
    .map((account) => ({ account, score: scoreAccount(account, profile, weights, now) }))
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, 5);

  async function dismissEvents(account: AccountRecord) {
    await putAccount({ ...account, watchEvents: [] });
    await chrome.runtime.sendMessage({ type: 'REFRESH_WATCH_BADGE' }).catch(() => {});
    await reload();
  }

  async function draftFollowUp(account: AccountRecord) {
    const snap = latestSnapshot(account);
    if (!account.brief || !snap) return;
    setDrafting(account.domain);
    setNotice(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'GENERATE_OUTREACH',
        company: account.company,
        brief: account.brief,
        detections: snap.detections,
        news: snap.news,
        hiring: snap.hiring,
      })) as OutreachResponse;
      if (!res.ok) {
        setNotice(res.error);
        return;
      }
      const firstEvent = pendingWatchEvents(account)[0];
      await putAccount(
        addTouch(account, {
          id: `touch:${Date.now()}:watch`,
          kind: 'email',
          persona: null,
          subject: res.draft.emailSubject,
          body: res.draft.emailBody,
          signal: firstEvent ? firstEvent.summary : res.draft.signal,
          createdAt: Date.now(),
          sentAt: null,
          scheduledFor: Date.now(),
        }),
      );
      setNotice(`Follow-up drafted for ${account.company} — find it in Accounts to copy and send.`);
      await reload();
    } finally {
      setDrafting(null);
    }
  }

  return (
    <main>
      <h1>Today</h1>
      <p className="no-print">
        <button className="link" onClick={onBack}>
          Back to current page
        </button>{' '}
        <button className="link" onClick={onOpenAccounts}>
          All accounts
        </button>
      </p>
      {notice && (
        <p>
          <small>{notice}</small>
        </p>
      )}

      <section>
        <h2>New signals</h2>
        {withEvents.length === 0 && (
          <p>
            <small>
              No changes detected. Watching runs every 6 hours while Chrome is open — toggle
              “Watch” on an account to include it.
            </small>
          </p>
        )}
        {withEvents.map((account) => (
          <div key={account.domain}>
            <p>
              <strong>{account.company}</strong>{' '}
              <small>
                <a href={account.url} target="_blank" rel="noreferrer">
                  {account.domain}
                </a>
              </small>
            </p>
            <ul>
              {pendingWatchEvents(account).map((e) => (
                <li key={e.id}>
                  <small>
                    {e.summary} · {new Date(e.at).toLocaleDateString()}
                  </small>
                </li>
              ))}
            </ul>
            <p className="no-print">
              {account.brief && (
                <>
                  <button
                    className="link"
                    onClick={() => void draftFollowUp(account)}
                    disabled={drafting === account.domain}
                  >
                    {drafting === account.domain ? 'Drafting…' : 'Draft follow-up'}
                  </button>{' '}
                </>
              )}
              <button className="link" onClick={() => void dismissEvents(account)}>
                Dismiss
              </button>
            </p>
          </div>
        ))}
      </section>

      <section>
        <h2>Touches due</h2>
        {dueTouches.length === 0 && <p><small>Nothing due. Sequences schedule touches for days 1, 4 and 9.</small></p>}
        {dueTouches.map(({ account, touch }) => (
          <p key={touch.id}>
            <small>
              <strong>{account.company}</strong> · {touch.kind}
              {touch.persona ? ` · ${touch.persona}` : ''}
              {touch.subject ? ` · “${touch.subject}”` : ''} · due{' '}
              {touch.scheduledFor ? new Date(touch.scheduledFor).toLocaleDateString() : ''}
            </small>{' '}
            <button
              className="link no-print"
              onClick={async () => {
                await navigator.clipboard.writeText(touch.body);
              }}
            >
              Copy
            </button>{' '}
            <button
              className="link no-print"
              onClick={async () => {
                await putAccount(markTouchSent(account, touch.id, Date.now()));
                await reload();
              }}
            >
              Mark sent
            </button>
          </p>
        ))}
      </section>

      <section>
        <h2>Top accounts to work</h2>
        {topAccounts.length === 0 && <p><small>No researched accounts yet.</small></p>}
        {topAccounts.map(({ account, score }) => (
          <p key={account.domain}>
            <small>
              <strong>{account.company}</strong> · score {score.total}
              {score.components[0] ? ` · ${score.components[0].label}` : ''}
            </small>
          </p>
        ))}
      </section>
    </main>
  );
}
