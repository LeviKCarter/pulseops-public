'use client';

import { useState, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { liveFeedUrl } from './liveFeedUrl';
import { dealItem, foodKey, priceTag } from './foodPrice';
import { isDealLive, useDenverNow, useRockiesYesterday } from './gameDayDeals';
import DismissedList from './DismissedList';
import FoodDeals, { GLANCE_PILLS, useDealsGlance, type FoodItem } from './FoodDeals';
import GearWatch from './GearWatch';
import UpcomingEvents, { CAMPUS_GROUPS, eventKey, groupOf, isFreeEvent, type EventItem } from './UpcomingEvents';
import { JOB_STAGES, isJobStageId, jobKey, type JobStageEntry, type JobStageId } from './jobStages';
import { CLEAR_JOB_FILTERS, JobFilterBar, describeJobFilters, filterRoles, useJobFilters } from './JobFilters';
import LaneIcon, { LaneChip, LanePreview, PreviewRow, type Lane } from './LaneIcon';
import LanePanel from './LanePanel';
import { ConditionsCard, MorningBrief, WeatherGlance, parseWeather } from './PulseBrief';
import ScentCard from './ScentCard';
import RssFeed, { type RssItem } from './RssFeed';
import { CollapseButton, read as readPersisted, useIsPhone, usePersisted, usePhoneLane, write as writePersisted } from './useCollapsed';
import { useNow } from './useNow';
import {
  queueRows as initialRows,
  snapshot as initialSnapshot,
  collabCards as initialCollabCards,
  type CollabCardsData,
  type CollabCardState,
  type EventTopItem,
  type FoodTopDeal,
  type GearItem,
  type JobItem,
  type JobTopItem,
  type PulseItem,
  type PulseSnapshot,
  type QueueRow,
  type SnapshotState,
} from './queueSnapshot';

const DISMISSED_FOOD_KEY = 'leviops-food-dismissed-v2';

// A dismissed food deal. `synced` is true once the sheet's Status has been set to DISMISSED; until the next
// snapshot refresh drops the row from the feed, the entry keeps it hidden here. Unsynced entries are hidden on
// this device only (the sheet write failed or this is not the local dashboard).
interface DismissedFood { key: string; kind: 'verified' | 'recurring'; restaurant: string; deal: string; synced: boolean }

// A dismissed food deal as the local server reads it back from the sheet, for the Restore list.
interface SheetDismissedFood { kind: 'verified' | 'recurring'; restaurant: string; deal: string; price?: string; location?: string; validThrough?: string; dismissedOn?: string }

const DISMISSED_EVENTS_KEY = 'leviops-events-dismissed-v1';

// A dismissed event. `synced` is true once the ledger row's Disposition has been set to Ignored; until the next snapshot
// refresh drops the row from the feed, the entry keeps it hidden here. Unsynced entries are hidden on this device only
// (the sheet write failed or this is not the local dashboard). `start` lets old unsynced entries expire with the event.
interface DismissedEvent { key: string; start: string; synced: boolean }

// A dismissed event as the local server reads it back from the ledger sheet, for the Restore list.
interface SheetDismissedEvent { eventName: string; start: string; venue: string; category?: string; was?: string }

const JOB_STAGES_KEY = 'leviops-job-stages-v1';

// A role's stage as this browser holds it. `synced` means the local server has confirmed it; an entry without it was made
// while the server was unreachable, or before stages were shared, and is pushed up on the next sync.
type LocalJobStages = Record<string, JobStageEntry & { synced?: boolean }>;

// Readers for the saved copies above; storage that is blocked or corrupt reads as nothing saved.
function parseDismissedFood(raw: string): DismissedFood[] {
  try {
    const saved = JSON.parse(raw);
    if (Array.isArray(saved)) return saved.filter((e): e is DismissedFood => !!e && typeof e.key === 'string' && typeof e.restaurant === 'string' && typeof e.deal === 'string' && (e.kind === 'verified' || e.kind === 'recurring'));
  } catch { /* start with nothing dismissed */ }
  return [];
}
// Entries for events that started over a week ago are dropped. Entries saved before sheet sync existed have no `synced`
// flag: they are device-only.
function parseDismissedEvents(raw: string, now: number | null): DismissedEvent[] {
  try {
    const saved = JSON.parse(raw);
    const cutoff = now === null ? '' : new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    if (Array.isArray(saved)) return saved.filter((e) => !!e && typeof e.key === 'string' && typeof e.start === 'string' && e.start.slice(0, 10) >= cutoff).map((e): DismissedEvent => ({ key: e.key, start: e.start, synced: e.synced === true }));
  } catch { /* start with nothing dismissed */ }
  return [];
}
function parseJobStages(raw: string): LocalJobStages {
  const valid: LocalJobStages = {};
  try {
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [key, entry] of Object.entries(saved as Record<string, { stage?: unknown; at?: unknown; synced?: unknown }>)) {
        if (entry && isJobStageId(entry.stage) && typeof entry.at === 'string') valid[key] = { stage: entry.stage, at: entry.at, ...(entry.synced === true ? { synced: true } : {}) };
      }
    }
  } catch { /* start with nothing tracked */ }
  return valid;
}
// Once a snapshot refresh has dropped a dismissed row from the feed, the sheet is doing the hiding, so its synced entry is
// dropped too (the next save stores the shorter list). Without a live, non-empty feed there is nothing to go by.
function dropSyncedGone<T extends { key: string; synced: boolean }>(entries: T[], feedKeys: string[] | null): T[] {
  if (!feedKeys?.length) return entries;
  const present = new Set(feedKeys);
  const next = entries.filter((e) => !e.synced || present.has(e.key));
  return next.length === entries.length ? entries : next;
}

const sourceLinks = {
  queue: 'https://docs.google.com/spreadsheets/d/YOUR_QUEUE_SPREADSHEET_ID/edit',
  food: 'https://docs.google.com/spreadsheets/d/YOUR_FOOD_SPREADSHEET_ID/edit',
  events: 'https://docs.google.com/spreadsheets/d/YOUR_EVENTS_SPREADSHEET_ID/edit',
  jobs: 'https://docs.google.com/spreadsheets/d/YOUR_QUEUE_SPREADSHEET_ID/edit#gid=1406638223',
};



function SheetMark({ color, label }: { color: string; label: string }) {
  return (
    <span className={`grid h-12 w-12 place-items-center rounded-2xl ${color}`} aria-label={label}>
      <span aria-hidden="true" className="grid h-5 w-4 grid-cols-2 gap-[2px] rounded-[3px] border border-[#17231d]/55 p-[2px]">
        <i className="bg-[#17231d]/45" /><i className="bg-[#17231d]/22" />
        <i className="bg-[#17231d]/22" /><i className="bg-[#17231d]/45" />
      </span>
    </span>
  );
}

function SourceButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-2 rounded-full border border-white/12 bg-white/[0.045] px-3.5 py-2 text-[0.8125rem] font-bold text-[#eef3ef] transition hover:border-white/25 hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f7c972]">
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

// The LeviAgent job pipeline's last scheduled run, as the snapshot passes it through (jobs card state.pipeline).
type JobPipelineStatus = { ok: boolean; at: string; detail: string };
const JOB_PIPELINE_STALE_HOURS = 30; // a daily 6 AM run, plus the sign-in catch-up, plus slack

// A warning for the jobs card when the tracker is not current: the last run was skipped (failing tests), or no run has
// finished in over a day (PC off, signed out, crashed). No status file yet means nothing to say.
// `short` is the phone home tile's one-liner; the card itself has room for the reason.
function jobPipelineWarning(status: JobPipelineStatus | null | undefined, now: number | null, short = false): string | null {
  if (!status?.at) return null;
  const at = Date.parse(status.at);
  if (Number.isNaN(at)) return null;
  const when = new Date(at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  if (!status.ok) return short ? `Search skipped ${when}` : `Job search skipped ${when}: ${status.detail || 'the pipeline did not finish'}. These are the previous results.`;
  if (now === null) return null; // server render: whether it is stale waits for the client's clock
  const hours = (now - at) / 3_600_000;
  if (hours > JOB_PIPELINE_STALE_HOURS) return short ? `Not run since ${when}` : `Job search hasn't run since ${when} (${Math.floor(hours / 24)}+ days). These results may be out of date.`;
  return null;
}

function StatusPill({ tone, children }: { tone: 'success' | 'danger' | 'warning' | 'neutral'; children: ReactNode }) {
  const styles = {
    success: 'bg-[#163426] text-[#8de0ad]',
    danger: 'bg-[#3b211b] text-[#ff9d7e]',
    warning: 'bg-[#3b3018] text-[#f0cb6d]',
    neutral: 'bg-[#282d2a] text-[#bcc6c0]',
  };
  return <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[0.75rem] font-extrabold uppercase tracking-[0.06em] ${styles[tone]}`}>{children}</span>;
}

function MetricCard({ label, value, detail, tone = 'plain' }: { label: string; value: string; detail: string; tone?: 'dark' | 'gold' | 'plain' }) {
  const shell = tone === 'dark'
    ? 'border-[#6bd296]/15 bg-[#153a28] text-white shadow-[0_18px_50px_rgba(0,0,0,.2)]'
    : tone === 'gold'
      ? 'border-[#f7c972]/18 bg-[#332a16] text-[#ffdc87]'
      : 'border-white/10 bg-white/[0.04] text-[#eef3ef]';
  return (
    <article className={`rounded-[22px] border p-5 ${shell}`}>
      <p className={`text-xs font-semibold ${tone === 'gold' ? 'text-[#f7d681]/62' : 'text-white/72'}`}>{label}</p>
      <div className="mt-5 flex items-end justify-between gap-3">
        <strong className="text-[2.45rem] font-semibold leading-none tracking-[-0.06em]">{value}</strong>
        <span className={`max-w-28 text-right text-[0.8125rem] leading-4 ${tone === 'gold' ? 'text-[#f7d681]/58' : 'text-white/72'}`}>{detail}</span>
      </div>
    </article>
  );
}

type StatItem = [React.ReactNode, string];

// One quiet line of numbers for the bottom of a lane card.
function StatLine({ items }: { items: StatItem[] }) {
  return (
    <p className="card-stats border-t border-white/[0.07] pt-4 text-[0.8125rem] leading-6 text-white/62">
      {items.map(([value, label], index) => (
        <span key={label}>
          {index > 0 && <span aria-hidden="true" className="px-1.5 text-white/30">·</span>}
          <strong className="font-semibold text-white/85">{value}</strong> {label}
        </span>
      ))}
    </p>
  );
}

function Breakdown({ items }: { items: Array<{ label: string; value: number; color: string }> }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.07]" aria-label={items.map((item) => `${item.label}: ${item.value}`).join(', ')}>
        {items.map((item) => <span key={item.label} className={item.color} style={{ width: `${(item.value / total) * 100}%` }} />)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {items.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-[0.8125rem] text-white/72">
            <i className={`h-2 w-2 rounded-full ${item.color}`} /> {item.value} {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// `tracked` marks a role listed only because it has an application stage (see fetch_jobs_collab), not because it is apply-ready.
type RoleItem = JobItem & { fitScore?: string; deadline?: string; tracked?: boolean };

// The live feed is untrusted JSON, so list fields are checked before they are treated as items.
function asItems<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// The same check for record fields (a card's topItem, the pulse state): only a plain object is treated as one.
function asRecord<T>(value: unknown): T | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
}

// The event ledger writes Denver local time as 'YYYY-MM-DD H:MM AM/PM' or a bare date; format it without any timezone shift.
function formatEventStart(raw: string | undefined, stack = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)?)?/i.exec((raw || '').trim());
  if (!m) return raw || '';
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return m[4] ? `${day}${stack ? '\n' : ' '}${m[4]}${m[5] ? ' ' + m[5].toUpperCase() : ''}` : day;
}

// The same ledger time split for a calendar-style date block: weekday, day of month, and the time if there is one.
function eventDay(raw: string | undefined): { dow: string; day: number; time: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)?)?/i.exec((raw || '').trim());
  if (!m) return null;
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return { dow, day: Number(m[3]), time: m[4] ? `${m[4]}${m[5] ? ' ' + m[5].toUpperCase() : ''}` : '' };
}

// Feed text is data, so only http(s) links are ever rendered as hrefs.
function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function formatDenverTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' });
}

function formatRelativeTime(iso: string, now: Date): string {
  try {
    const then = new Date(iso).getTime();
    if (!then || isNaN(then)) return 'Just now';
    const diff = Math.max(0, Math.floor((now.getTime() - then) / 1000));
    if (diff < 10) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  } catch {
    return 'Just now';
  }
}

interface LiveFeedRow {
  record_type?: string;
  id_or_key?: string;
  status?: string;
  engine?: string;
  current_step?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  value?: string;
  detail?: string;
  snapshot_updated_at?: string;
}

interface LiveFeedPayload {
  schema?: string;
  snapshot_updated_at?: string;
  rows?: LiveFeedRow[];
}

// Ticks every second on its own, so only this footer badge re-renders instead of the whole dashboard (which made phone scrolling stutter).
function FeedClock({ isLive, updatedAt, lastCheckedAt }: { isLive: boolean; updatedAt: string; lastCheckedAt: Date | null }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0); // show the date right after hydration instead of a second later
    const interval = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, []);
  const diffSeconds = now ? Math.max(0, Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 1000)) : 0;
  const isStale = diffSeconds > 1800; // 30 minutes
  const relativeFreshness = now ? formatRelativeTime(updatedAt, now) : 'Just now';
  const lastCheckedFreshness = lastCheckedAt && now ? `${Math.max(0, Math.floor((now.getTime() - lastCheckedAt.getTime()) / 1000))}s ago` : 'waiting';
  return (
    <>
      <p className="text-sm text-white/72">{now ? `${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Denver' })} · Denver` : 'Denver'}</p>
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8125rem] font-semibold ${isLive && !isStale ? 'border-[#2f9a65]/25 bg-[#143525]/60 text-[#8de0ad]' : isStale ? 'border-[#f7c972]/25 bg-[#332a16]/60 text-[#f7c972]' : 'border-white/10 bg-white/[0.04] text-white/78'}`}>
        <span className="relative flex h-1.5 w-1.5">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${isLive && !isStale ? 'bg-[#34d399]' : isStale ? 'bg-[#f7c972]' : 'bg-white/40'}`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${isLive && !isStale ? 'bg-[#10b981]' : isStale ? 'bg-[#e5a83b]' : 'bg-white/50'}`} />
        </span>
        {isLive ? (isStale ? `Stale dashboard feed · checked ${lastCheckedFreshness}` : `Live dashboard feed · Connected · checked ${lastCheckedFreshness}`) : `Snapshot · ${relativeFreshness}`}
      </span>
    </>
  );
}

function asTone(value: string | undefined): 'success' | 'danger' | 'warning' | 'neutral' {
  return value === 'success' || value === 'danger' || value === 'warning' || value === 'neutral' ? value : 'neutral';
}

function parseLiveFeed(liveData: LiveFeedPayload | null | undefined): {
  snapshot: SnapshotState;
  queueRows: QueueRow[];
  collabCards: CollabCardsData;
} | null {
  if (!liveData || (liveData.schema !== 'levi-ops-live-v1' && liveData.schema !== 'levi-ops-live-v2') || !Array.isArray(liveData.rows)) return null;
  const stamp = liveData.snapshot_updated_at || new Date().toISOString();
  let updatedLabel = 'Just now';
  try {
    const d = new Date(stamp);
    updatedLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {}

  const snap: SnapshotState = {
    updatedAt: stamp,
    updatedLabel,
    running: 0,
    queued: 0,
    activeLeases: 0,
    requestsPending: 0,
    requestsBlank: 0,
    requestsAttention: 0,
    latestFailureId: '',
    latestFailureDetail: 'No recent failures',
    systemLabel: 'System state unavailable',
    systemDetail: 'Live dashboard payload is missing system detail.',
    workerId: '—',
    workerStatus: 'unknown',
    workerLabel: 'Worker state unavailable',
    workerVersion: '—',
    workerLastSeen: '',
    workerLastSeenLabel: '—',
    sparkGmailHealth: 'UNKNOWN',
    diskFree: '—',
    workerNote: 'No worker note in the live payload.',
    fleetHealth: 'UNKNOWN',
    providerStatus: 'UNKNOWN',
    providerUsage: {
      gemini: { status: 'UNKNOWN', tasksToday: 0, tokensToday: null, detail: 'Usage unavailable', resetAt: '' },
      deepseek: { status: 'UNKNOWN', tasksToday: 0, tokensToday: null, detail: 'Usage unavailable', resetAt: '' },
      claude: { status: 'UNKNOWN', tasksToday: 0, tokensToday: null, detail: 'Usage unavailable', resetAt: '' },
    },
    edgeFeedStatus: 'UNKNOWN',
    retainedTerminalHistory: 0,
    retainedDone: 0,
    retainedFailed: 0,
    historicalDlq: 0,
    archivedRecords: 0,
    queueAttentionMeta: 'Current',
    queueAttentionTitle: 'No queue attention signal',
    queueAttentionDetail: 'No queue attention detail in the live payload.',
    queueAttentionTone: 'neutral',
    requestsAttentionMeta: '0 rows',
    requestsAttentionTitle: 'Ingress state unavailable',
    requestsAttentionDetail: 'No ingress attention detail in the live payload.',
    requestsAttentionTone: 'neutral',
    eventsAttentionMeta: 'Latest triage',
    eventsAttentionTitle: 'Event triage unavailable',
    eventsAttentionDetail: 'No event attention detail in the live payload.',
    eventsAttentionTone: 'neutral',
    foodAttentionMeta: '0 rows',
    foodAttentionTitle: 'Food review state unavailable',
    foodAttentionDetail: 'No food attention detail in the live payload.',
    foodAttentionTone: 'neutral',
  };
  const rows: QueueRow[] = [];
  const collab: CollabCardsData = {
    version: liveData.schema === 'levi-ops-live-v2' ? '2' : '1',
    updatedAt: stamp,
    food: { count: 0, status: 'unavailable', topItem: null, stats: {}, state: { recurring: [], priority: [] } },
    events: { count: 0, status: 'unavailable', topItem: null, stats: {}, state: { items: [] } },
    jobs: { count: 0, status: 'unavailable', topItem: null, stats: {}, state: { items: [] } },
    pulse: { count: 0, status: 'not_run', topItem: null, stats: {}, state: undefined },
  };
  const attentionKeys: Record<string, 'queue' | 'requests' | 'events' | 'food'> = {
    queue: 'queue', requests: 'requests', events: 'events', food: 'food',
  };

  const foodOverflow: unknown[] = [];
  const eventsOverflow: unknown[] = [];
  for (const r of liveData.rows) {
    if (r.record_type === 'metric') {
      const val = Number.parseInt(r.value || '0', 10) || 0;
      if (r.id_or_key === 'running') snap.running = val;
      else if (r.id_or_key === 'queued') snap.queued = val;
      else if (r.id_or_key === 'active_leases') snap.activeLeases = val;
      else if (r.id_or_key === 'requests_pending') snap.requestsPending = val;
      else if (r.id_or_key === 'requests_blank') snap.requestsBlank = val;
      else if (r.id_or_key === 'requests_attention') snap.requestsAttention = val;
      else if (r.id_or_key === 'retained_terminal_history') snap.retainedTerminalHistory = val;
      else if (r.id_or_key === 'retained_done') snap.retainedDone = val;
      else if (r.id_or_key === 'retained_failed') snap.retainedFailed = val;
      else if (r.id_or_key === 'historical_dlq') snap.historicalDlq = val;
      else if (r.id_or_key === 'archived_records') snap.archivedRecords = val;
    } else if (r.record_type === 'status') {
      if (r.id_or_key === 'system') {
        snap.systemLabel = r.status || 'System state unavailable';
        snap.systemDetail = r.detail || 'No live system detail.';
      } else if (r.id_or_key === 'latest_failure') {
        snap.latestFailureDetail = r.detail || 'No recent failures';
        const match = (r.detail || '').match(/^#([^\s·]+)/);
        snap.latestFailureId = match ? match[1] : '';
      }
    } else if (r.record_type === 'worker') {
      const value = r.value || '';
      if (r.id_or_key === 'workerId') snap.workerId = value || '—';
      else if (r.id_or_key === 'workerStatus') snap.workerStatus = value || 'unknown';
      else if (r.id_or_key === 'workerLabel') snap.workerLabel = value || 'Worker state unavailable';
      else if (r.id_or_key === 'workerVersion') snap.workerVersion = value || '—';
      else if (r.id_or_key === 'workerLastSeen') snap.workerLastSeen = value;
      else if (r.id_or_key === 'workerLastSeenLabel') snap.workerLastSeenLabel = value || '—';
      else if (r.id_or_key === 'sparkGmailHealth') snap.sparkGmailHealth = value || 'UNKNOWN';
      else if (r.id_or_key === 'diskFree') snap.diskFree = value || '—';
      else if (r.id_or_key === 'workerNote') snap.workerNote = value || 'No live worker note.';
    } else if (r.record_type === 'health') {
      const value = r.value || 'UNKNOWN';
      if (r.id_or_key === 'fleetHealth') snap.fleetHealth = value;
      else if (r.id_or_key === 'providerStatus') snap.providerStatus = value;
      else if (r.id_or_key === 'edgeFeedStatus') snap.edgeFeedStatus = value;
    } else if (r.record_type === 'provider_usage') {
      const family = r.id_or_key as 'gemini' | 'deepseek' | 'claude';
      if (family === 'gemini' || family === 'deepseek' || family === 'claude') {
        let detail: { tokensToday?: number | null; detail?: string; resetAt?: string } = {};
        try { detail = JSON.parse(r.detail || '{}'); } catch {}
        snap.providerUsage[family] = { status: r.status || 'UNKNOWN', tasksToday: Number.parseInt(r.value || '0',10) || 0, tokensToday: typeof detail.tokensToday === 'number' ? detail.tokensToday : null, detail: detail.detail || 'Usage unavailable', resetAt: detail.resetAt || '' };
      }
    } else if (r.record_type === 'attention') {
      const key = attentionKeys[r.id_or_key || ''];
      if (!key) continue;
      let payload: { meta?: string; detail?: string } = {};
      try { payload = JSON.parse(r.detail || '{}') as { meta?: string; detail?: string }; } catch {}
      const title = r.value || 'No attention signal';
      const meta = payload.meta || 'Current';
      const detail = payload.detail || 'No live detail.';
      const tone = asTone(r.status);
      if (key === 'queue') {
        snap.queueAttentionTitle = title; snap.queueAttentionMeta = meta; snap.queueAttentionDetail = detail; snap.queueAttentionTone = tone;
      } else if (key === 'requests') {
        snap.requestsAttentionTitle = title; snap.requestsAttentionMeta = meta; snap.requestsAttentionDetail = detail; snap.requestsAttentionTone = tone;
      } else if (key === 'events') {
        snap.eventsAttentionTitle = title; snap.eventsAttentionMeta = meta; snap.eventsAttentionDetail = detail; snap.eventsAttentionTone = tone;
      } else {
        snap.foodAttentionTitle = title; snap.foodAttentionMeta = meta; snap.foodAttentionDetail = detail; snap.foodAttentionTone = tone;
      }
    } else if (r.record_type === 'collab_card') {
      const keyMap: Record<string, 'food' | 'events' | 'jobs' | 'pulse'> = {
        food_deals: 'food',
        denver_events: 'events',
        science_jobs: 'jobs',
        pulse: 'pulse',
      };
      // The food and event lists are bigger than one sheet cell, so their tails arrive in '<key>_more', '_more2', ... rows.
      const more = /^(food_deals|denver_events)_more\d*$/.exec(r.id_or_key || '');
      if (more) {
        try { (more[1] === 'food_deals' ? foodOverflow : eventsOverflow).push(...asItems<unknown>((JSON.parse(r.detail || '{}') as { items?: unknown }).items)); } catch {}
        continue;
      }
      const key = keyMap[r.id_or_key || ''];
      if (!key) continue;
      let payload: { topItem?: unknown; items?: unknown[]; stats?: Record<string, number>; state?: unknown; recurring?: unknown[]; priority?: unknown[]; gear?: unknown[] } = {};
      try { payload = JSON.parse(r.detail || '{}'); } catch {}
      const status = (r.status || 'unavailable') as CollabCardState<unknown>['status'];
      const count = Number.parseInt(r.value || '0', 10) || 0;
      if (key === 'food') {
        collab.food = {
          count,
          status,
          topItem: asRecord<FoodTopDeal>(payload.topItem),
          items: payload.items || [],
          stats: payload.stats || {},
          state: payload.state || { recurring: payload.recurring || [], priority: payload.priority || [] },
          gear: asItems<GearItem>(payload.gear),
        };
      } else if (key === 'events') {
        collab.events = {
          count,
          status,
          topItem: asRecord<EventTopItem>(payload.topItem),
          items: payload.items || [],
          stats: payload.stats || {},
          state: payload.state || { items: payload.items || [] },
        };
      } else if (key === 'jobs') {
        collab.jobs = {
          count,
          status,
          topItem: asRecord<JobTopItem>(payload.topItem),
          items: payload.items || [],
          stats: payload.stats || {},
          state: payload.state || { items: payload.items || [] },
        };
      } else if (key === 'pulse') {
        collab.pulse = {
          count,
          status,
          topItem: asRecord<PulseItem>(payload.topItem),
          items: payload.items || [],
          stats: payload.stats || {},
          state: asRecord<PulseSnapshot>(payload.state) ?? undefined,
        };
      }
    } else if (r.record_type === 'task') {
      const status = r.status || 'Unknown';
      const lower = status.toLowerCase();
      const tone = lower === 'done' ? 'success' : lower === 'failed' ? 'danger' : lower === 'running' || lower === 'queued' ? 'warning' : 'neutral';
      rows.push({ id: r.id_or_key || 'unknown', status, step: r.current_step || status, engine: r.engine || '—', finished: r.detail || '—', tone });
    }
  }
  if (foodOverflow.length) collab.food = { ...collab.food, items: [...asItems<unknown>(collab.food.items), ...foodOverflow] };
  if (eventsOverflow.length) collab.events = { ...collab.events, items: [...asItems<unknown>(collab.events.items), ...eventsOverflow] };
  return { snapshot: snap, queueRows: rows, collabCards: collab };
}

export default function Home() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [queueRows, setQueueRows] = useState(initialRows);
  const [collabCards, setCollabCards] = useState<CollabCardsData>(initialCollabCards);
  const [isLive, setIsLive] = useState(false);
  const now = useNow();
  // The tab bar is gone, so this stays on 'research'; the Agent and Sources panels below are parked, not deleted.
  const [activeTab] = useState<'agent' | 'research' | 'sources'>('research');
  // Pulse and Events open wide (one at a time). Science jobs and Deals open as a panel over the whole screen, with the lane's
  // icon held at the exact spot it was clicked: nothing under the panel moves, so closing puts the page back as it was.
  const [expandedLane, setExpandedLane] = useState<Lane | null>(null);
  const [panel, setPanel] = useState<{ lane: 'jobs' | 'food'; x: number; y: number } | null>(null);
  const [phoneLane, setPhoneLane] = usePhoneLane();
  // Quick toggles on the phone overview's Events panel. CU campus talks and concerts start hidden, as in the Events lane.
  const [homeShowCU, setHomeShowCU] = useState(false);
  const [homeShowConcerts, setHomeShowConcerts] = useState(false);
  const [homeFreeOnly, setHomeFreeOnly] = useState(false);
  // The morning brief under the Pulse weather on the phone overview; while it is open, the Pulse panel grows to fit.
  const [homeBriefOpen, setHomeBriefOpen] = useState(false);
  // Phones show only the open lane's card; the others wait as buttons in the row above it.
  const phoneHidden = (lane: Lane) => (phoneLane === lane ? '' : ' lane-phone-hidden');
  // With one lane open at a time, a phone always shows it in full, so there is no expand toggle there.
  const isPhone = useIsPhone();
  const wide = (lane: Lane) => (isPhone ? phoneLane === lane : expandedLane === lane);
  // The lane's source sheet, rarely opened, so it sits at the very bottom of the lane rather than in its header.
  const sheetLink = (href: string) => <div className="mt-4"><SourceButton href={href}>Open sheet</SourceButton></div>;
  // Phone-only header controls for the open lane: the other three lanes as icons beside its name, then the button back
  // to the overview.
  const phoneControls = (lane: Lane, name: string) => (
    <>
      <nav aria-label="Lanes" className="flex shrink-0 gap-1.5 md:hidden">
        {(['pulse', 'events', 'jobs', 'food'] as const).filter((other) => other !== lane).map((other) => (
          <LaneChip key={other} lane={other} compact onOpen={() => setPhoneLane(other)} />
        ))}
      </nav>
      <CollapseButton collapsed={false} onToggle={() => setPhoneLane(null)} label={`the ${name} lane`} />
    </>
  );
  const panelIcon = useRef<HTMLElement | null>(null);
  const dealsCard = useRef<HTMLElement | null>(null);
  const isPanelLane = (lane: Lane): lane is 'jobs' | 'food' => lane === 'jobs' || lane === 'food';
  const closePanel = () => { setPanel(null); panelIcon.current?.focus(); };
  const toggleLane = (lane: Lane, from?: HTMLElement) => {
    if (isPanelLane(lane)) {
      if (panel) { closePanel(); return; }
      // The icon's centre, less half its 2.25rem size, so a hover scale on the icon while it is clicked cannot shift the panel's copy.
      const r = from?.getBoundingClientRect();
      panelIcon.current = from ?? null;
      setPanel({ lane, ...(r ? { x: r.left + r.width / 2 - 18, y: r.top + r.height / 2 - 18 } : { x: 24, y: 24 }) });
      return;
    }
    const opening = expandedLane !== lane;
    setExpandedLane(opening ? lane : null);
    // The expanded lane moves to the top of the lanes, so bring that top into view if the page is scrolled past it. The
    // jump is instant: html's smooth scroll-behavior made every expand crawl up the page for half a second.
    if (opening) window.setTimeout(() => {
      const sheets = document.getElementById('sheets');
      if (sheets && sheets.getBoundingClientRect().top < 0) sheets.scrollIntoView({ behavior: 'instant', block: 'start' });
    }, 0);
  };
  // Expanding Events keeps Pulse open beside it on wide screens: Events takes the first three columns and Pulse stays on the right.
  const laneCard = (lane: Lane) => {
    if (expandedLane === 'events') {
      if (lane === 'events') return 'sheet-card lane-expanded lane-beside order-first md:col-span-2 xl:-order-2 xl:col-span-3';
      if (lane === 'pulse') return 'sheet-card xl:-order-1';
    }
    return `sheet-card${expandedLane === lane ? ' lane-expanded order-first md:col-span-2 xl:col-span-4' : ''}`;
  };
  // A tap on a lane itself (not on a link, button, or other control inside it) toggles it. On a phone the open lane goes
  // back to the four-lane overview, and so does a tap on the bare background. On wider screens a tap expands a lane or
  // collapses the expanded one, and a tap inside a Science jobs or Deals panel closes it. A drag that selects text is
  // left alone.
  const toggleLaneRef = useRef<(lane: Lane, from?: HTMLElement) => void>(() => {});
  useEffect(() => { toggleLaneRef.current = toggleLane; });
  useEffect(() => {
    if (isPhone && !phoneLane) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.isConnected || target.closest('a, button, input, select, textarea, label, summary, [role="button"], [role="tab"], [tabindex], [data-own-click]')) return;
      if (window.getSelection()?.toString()) return;
      if (isPhone) {
        if (!target.closest('nav[aria-label="Lanes"]')) setPhoneLane(null);
      } else if (panel) {
        if (target.closest('[role="dialog"]')) { setPanel(null); panelIcon.current?.focus(); }
      } else {
        const card = target.closest<HTMLElement>('.sheet-card[data-lane]');
        const lane = card?.dataset.lane as Lane | undefined;
        // The card's own icon button is where a Science jobs or Deals panel anchors its header.
        if (card && lane) toggleLaneRef.current(lane, card.querySelector<HTMLElement>('button[aria-expanded]') ?? undefined);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [isPhone, phoneLane, panel, setPhoneLane]);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  // Food deals the user dismissed. Each click also asks the local server to mark the row DISMISSED in the sheet.
  // Kept in localStorage (memory when storage is blocked); the server render starts with nothing dismissed.
  const savedFoodRaw = usePersisted(DISMISSED_FOOD_KEY, '[]');
  const savedFood = useMemo(() => parseDismissedFood(savedFoodRaw), [savedFoodRaw]);
  const dismissedFood = useMemo(
    () => dropSyncedGone(savedFood, isLive ? asItems<FoodItem>(collabCards.food.items).map((i) => foodKey(i.restaurant, i.deal)) : null),
    [savedFood, isLive, collabCards],
  );
  const [foodNotice, setFoodNotice] = useState('');
  const saveDismissedFood = (next: DismissedFood[]) => writePersisted(DISMISSED_FOOD_KEY, JSON.stringify(next));
  const dismissFood = async (item: FoodItem) => {
    const entry: DismissedFood = { key: foodKey(item.restaurant, item.deal), kind: item.kind ?? 'verified', restaurant: item.restaurant, deal: item.deal, synced: false };
    const others = dismissedFood.filter((e) => e.key !== entry.key);
    saveDismissedFood([...others, entry]);
    setFoodNotice('');
    try {
      const resp = await fetch('/api/food-dismiss', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: entry.kind, restaurant: entry.restaurant, deal: entry.deal }),
      });
      const result = await resp.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!resp.ok || !result.ok) throw new Error(result.error || `HTTP ${resp.status}`);
      saveDismissedFood([...others, { ...entry, synced: true }]);
      void loadSheetDismissedFood();
    } catch (err) {
      setFoodNotice(`Hidden on this device only; the sheet wasn't updated (${err instanceof Error ? err.message : 'unknown error'}).`);
    }
  };
  // The sheet's dismissed food deals that are still worth restoring. They are no longer in the feed, so the local server reads
  // them from the sheet; null means that is not available here (not the local dashboard), and there is nothing to restore from.
  const [sheetDismissedFood, setSheetDismissedFood] = useState<SheetDismissedFood[] | null>(null);
  const [restoringFood, setRestoringFood] = useState('');
  const loadSheetDismissedFood = async () => {
    try {
      const resp = await fetch('/api/food-dismiss', { cache: 'no-store' });
      const result = await resp.json().catch(() => ({})) as { ok?: boolean; items?: SheetDismissedFood[] };
      setSheetDismissedFood(resp.ok && result.ok && Array.isArray(result.items) ? result.items : null);
    } catch { setSheetDismissedFood(null); }
  };
  useEffect(() => { void loadSheetDismissedFood(); }, []);
  const restoreFood = async (item: SheetDismissedFood) => {
    const key = foodKey(item.restaurant, item.deal);
    setRestoringFood(key);
    setFoodNotice('');
    try {
      const resp = await fetch('/api/food-dismiss', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', kind: item.kind, restaurant: item.restaurant, deal: item.deal }),
      });
      const result = await resp.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!resp.ok || !result.ok) throw new Error(result.error || `HTTP ${resp.status}`);
      setSheetDismissedFood((cur) => (cur ?? []).filter((d) => foodKey(d.restaurant, d.deal) !== key));
      saveDismissedFood(dismissedFood.filter((e) => e.key !== key));
      setFoodNotice('Restored in the sheet. It returns to the list at the next snapshot refresh.');
    } catch (err) {
      setFoodNotice(`Couldn't restore it (${err instanceof Error ? err.message : 'unknown error'}).`);
    } finally {
      setRestoringFood('');
    }
  };

  // Events the user is not interested in. Like food deals, each click also asks the local server to mark the ledger row Ignored.
  const savedEventsRaw = usePersisted(DISMISSED_EVENTS_KEY, '[]');
  const savedEvents = useMemo(() => parseDismissedEvents(savedEventsRaw, now), [savedEventsRaw, now]);
  const dismissedEvents = useMemo(
    () => dropSyncedGone(savedEvents, isLive ? asItems<EventItem>(collabCards.events.items).map(eventKey) : null),
    [savedEvents, isLive, collabCards],
  );
  const [eventNotice, setEventNotice] = useState('');
  const saveDismissedEvents = (next: DismissedEvent[]) => writePersisted(DISMISSED_EVENTS_KEY, JSON.stringify(next));
  const dismissEvent = async (event: EventItem) => {
    const entry: DismissedEvent = { key: eventKey(event), start: event.start, synced: false };
    const others = dismissedEvents.filter((e) => e.key !== entry.key);
    saveDismissedEvents([...others, entry]);
    setEventNotice('');
    try {
      const resp = await fetch('/api/events-dismiss', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName: event.eventName, start: event.start, venue: event.venue }),
      });
      const result = await resp.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!resp.ok || !result.ok) throw new Error(result.error || `HTTP ${resp.status}`);
      saveDismissedEvents([...others, { ...entry, synced: true }]);
      void loadSheetDismissed();
    } catch (err) {
      setEventNotice(`Hidden on this device only; the sheet wasn't updated (${err instanceof Error ? err.message : 'unknown error'}).`);
    }
  };
  // The ledger's dismissed events that have not started yet. They are no longer in the feed, so the local server reads
  // them from the sheet; null means that is not available here (not the local dashboard), and there is nothing to restore from.
  const [sheetDismissed, setSheetDismissed] = useState<SheetDismissedEvent[] | null>(null);
  const [restoringEvent, setRestoringEvent] = useState('');
  const loadSheetDismissed = async () => {
    try {
      const resp = await fetch('/api/events-dismiss', { cache: 'no-store' });
      const result = await resp.json().catch(() => ({})) as { ok?: boolean; items?: SheetDismissedEvent[] };
      setSheetDismissed(resp.ok && result.ok && Array.isArray(result.items) ? result.items : null);
    } catch { setSheetDismissed(null); }
  };
  useEffect(() => { void loadSheetDismissed(); }, []);
  const restoreEvent = async (item: SheetDismissedEvent) => {
    const key = eventKey(item);
    setRestoringEvent(key);
    setEventNotice('');
    try {
      const resp = await fetch('/api/events-dismiss', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', eventName: item.eventName, start: item.start, venue: item.venue }),
      });
      const result = await resp.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!resp.ok || !result.ok) throw new Error(result.error || `HTTP ${resp.status}`);
      setSheetDismissed((cur) => (cur ?? []).filter((e) => eventKey(e) !== key));
      saveDismissedEvents(dismissedEvents.filter((e) => e.key !== key));
      setEventNotice('Restored in the sheet. It returns to the list at the next snapshot refresh.');
    } catch (err) {
      setEventNotice(`Couldn't restore it (${err instanceof Error ? err.message : 'unknown error'}).`);
    } finally {
      setRestoringEvent('');
    }
  };

  // Application stage per role (Saved, Applied, Interviewing, ...). The local server keeps the shared copy, so every device on
  // the local dashboard sees the same stages. The browser keeps a cache for when the server cannot be reached and is the only
  // store on the published copy, which cannot write to the server.
  const jobStagesRaw = usePersisted(JOB_STAGES_KEY, '{}');
  const jobStages = useMemo(() => parseJobStages(jobStagesRaw), [jobStagesRaw]);
  // The async sync below needs the latest stages, not the ones this render saw.
  const currentJobStages = () => parseJobStages(readPersisted(JOB_STAGES_KEY, '{}'));
  const [jobView, patchJobView] = useJobFilters();
  const jobSync = useRef<'unknown' | 'on' | 'off'>('unknown');
  const [jobNotice, setJobNotice] = useState('');
  const [pickingJob, setPickingJob] = useState<string | null>(null);
  const saveJobStages = (next: LocalJobStages) => writePersisted(JOB_STAGES_KEY, JSON.stringify(next));
  const postJobStage = async (key: string, stage: JobStageId | null, at: string): Promise<Record<string, JobStageEntry>> => {
    const resp = await fetch('/api/job-stages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, stage, at }),
    });
    const result = await resp.json().catch(() => ({})) as { ok?: boolean; error?: string; stages?: Record<string, JobStageEntry> };
    if (!resp.ok || !result.ok || !result.stages) throw new Error(result.error || `HTTP ${resp.status}`);
    return result.stages;
  };
  // The server's map wins, except for changes made here that it does not have yet.
  const adoptServerStages = (server: Record<string, JobStageEntry>) => {
    const next: LocalJobStages = {};
    for (const [key, entry] of Object.entries(server)) next[key] = { ...entry, synced: true };
    for (const [key, entry] of Object.entries(currentJobStages())) {
      if (!entry.synced && (!server[key] || server[key].at < entry.at)) next[key] = entry;
    }
    saveJobStages(next);
  };
  // Resolves true once the server holds everything this browser has.
  const syncJobStages = async (): Promise<boolean> => {
    if (jobSync.current === 'off') return false;
    try {
      const resp = await fetch('/api/job-stages', { cache: 'no-store' });
      // A refusal means this is not the local dashboard, so stages stay in this browser and nothing more is tried.
      if (resp.status === 403) { jobSync.current = 'off'; return false; }
      const result = await resp.json().catch(() => ({})) as { ok?: boolean; stages?: Record<string, JobStageEntry> };
      if (!resp.ok || !result.ok || !result.stages) return false;
      let server = result.stages;
      // Catch the server up on stages set here while it was unreachable, and on any saved before stages were shared.
      for (const [key, entry] of Object.entries(currentJobStages())) {
        if (entry.synced || (server[key] && server[key].at >= entry.at)) continue;
        server = await postJobStage(key, entry.stage, entry.at);
      }
      jobSync.current = 'on';
      adoptServerStages(server);
      return true;
    } catch { return false; /* server unreachable right now: keep what this browser has and try again later */ }
  };
  useEffect(() => {
    // Whatever an earlier failed save left is now on the server, so its notice goes.
    const sync = () => { void syncJobStages().then((synced) => { if (synced) setJobNotice(''); }); };
    sync();
    // Pick up stages changed on another device when this one is looked at again, and now and then while it stays open.
    const refresh = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 30000);
    return () => { document.removeEventListener('visibilitychange', refresh); clearInterval(timer); };
  }, []);
  // Choosing the stage a role is already in clears it, so the same tag that sets a stage also removes it.
  const setJobStage = (key: string, stage: JobStageId) => {
    const current = currentJobStages();
    const clearing = current[key]?.stage === stage;
    const next = { ...current };
    const at = new Date().toISOString();
    if (clearing) delete next[key]; else next[key] = { stage, at };
    saveJobStages(next);
    setPickingJob(null);
    setJobNotice('');
    if (jobSync.current !== 'on') return;
    postJobStage(key, clearing ? null : stage, at).then(adoptServerStages, (err) => {
      setJobNotice(`Saved on this device only; the server wasn't updated (${err instanceof Error ? err.message : 'unknown error'}).`);
    });
  };

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let requestSeq = 0;
    let appliedSeq = 0;
    let lastAppliedStamp = 0;

    const clearTimer = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    };
    const scheduleNext = () => {
      if (!active) return;
      clearTimer();
      const delay = document.visibilityState === 'visible' ? 2000 : 30000;
      timer = setTimeout(() => { void fetchLiveFeed(); }, delay);
    };
    async function fetchLiveFeed() {
      if (!active || inFlight) return;
      inFlight = true;
      const seq = ++requestSeq;
      try {
        const resp = await fetch(liveFeedUrl(), {
          headers: { Accept: 'application/json' }, cache: 'no-store',
        });
        if (!resp.ok) return;
        const data = await resp.json() as LiveFeedPayload;
        if (!active) return;
        const parsed = parseLiveFeed(data);
        if (!parsed) return;
        const stampMs = Date.parse(data.snapshot_updated_at || parsed.snapshot.updatedAt) || 0;
        if (seq < appliedSeq || stampMs < lastAppliedStamp) return;
        appliedSeq = seq;
        lastAppliedStamp = stampMs;
        setSnapshot(parsed.snapshot);
        setQueueRows(parsed.queueRows);
        setCollabCards(parsed.collabCards);
        setIsLive(true);
        setLastCheckedAt(new Date());
      } catch {
        // Keep startup fallback before first success, or the last-good live state afterward.
      } finally {
        inFlight = false;
        scheduleNext();
      }
    }
    const fetchImmediately = () => {
      if (!active) return;
      clearTimer();
      if (!inFlight) void fetchLiveFeed();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchImmediately();
      else scheduleNext();
    };
    window.addEventListener('focus', fetchImmediately);
    window.addEventListener('online', fetchImmediately);
    document.addEventListener('visibilitychange', onVisibilityChange);
    void fetchLiveFeed();
    return () => {
      active = false;
      clearTimer();
      window.removeEventListener('focus', fetchImmediately);
      window.removeEventListener('online', fetchImmediately);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Deals show only in their context: their weekdays, dates and hours, or the day after a qualifying Rockies game
  // (see gameDayDeals.ts).
  const rockiesYesterday = useRockiesYesterday();
  const denverClock = useDenverNow();
  // The deals still showing after dismissals, split as the Deals lane lists them, for the phone overview's Deals panel.
  const glanceDeals = (() => {
    const hidden = new Set(dismissedFood.map((e) => e.key));
    const listed = asItems<FoodItem>(collabCards.food.items).filter((d) => !hidden.has(foodKey(d.restaurant, d.deal)) && isDealLive(d, rockiesYesterday, denverClock));
    return { verified: listed.filter((d) => d.kind !== 'recurring'), recurring: listed.filter((d) => d.kind === 'recurring') };
  })();
  const dealsGlance = useDealsGlance(glanceDeals.verified, glanceDeals.recurring);

  return (
    <main className="ops-shell min-h-screen text-[#eef3ef]">
      <div className="mx-auto min-h-screen max-w-[105rem]">
        <section className="min-w-0 px-4 pb-16 pt-2 sm:px-7 md:pt-4 lg:px-10 lg:pt-5 xl:px-12">
          {/* 1. AGENT TAB */}
          {activeTab === 'agent' && (
            <div className="mt-8 space-y-8">
              <div data-layout="primary-activity" className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,2.4fr)_minmax(320px,1fr)]">
                <div className="flex flex-col gap-6">
                  <section id="queue" className="flex flex-1 flex-col scroll-mt-6 rounded-[28px] border border-white/[0.09] bg-[#0f1713] p-4 shadow-[0_24px_80px_rgba(0,0,0,.18)] sm:p-6">
                    <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
                      <div><p className="section-kicker">Pulse Agent queue</p><h2 className="section-title">Latest save activity</h2><p className="mt-2 text-xs text-white/62">Task prompts, results, errors, commands, and transport IDs stay out of this view.</p></div>
                      <SourceButton href={sourceLinks.queue}>Open full queue</SourceButton>
                    </div>

                    <div className="mt-6 flex-1 grid gap-5">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[650px] border-collapse text-left">
                          <thead><tr className="text-[0.75rem] font-extrabold uppercase tracking-[0.08em] text-white/62"><th className="pb-3 font-inherit">Task</th><th className="pb-3 font-inherit">State</th><th className="pb-3 font-inherit">Step</th><th className="pb-3 font-inherit">Engine</th><th className="pb-3 text-right font-inherit">Finished</th></tr></thead>
                          <tbody className="divide-y divide-white/[0.07]">
                            {queueRows.map((task) => (
                              <tr key={task.id}>
                                <td className="py-3.5 font-mono text-xs text-white/72">#{task.id}</td>
                                <td className="py-3.5"><StatusPill tone={task.tone}>{task.status}</StatusPill></td>
                                <td className="py-3.5 text-xs font-semibold">{task.step}</td>
                                <td className="py-3.5 text-xs text-white/72">{task.engine}</td>
                                <td className="py-3.5 text-right text-xs text-white/62">{task.finished}</td>
                              </tr>
                            ))}
                            {queueRows.length === 0 && Array.from({ length: 15 }).map((_, i) => (
                              <tr key={`ghost-${i}`} aria-hidden="true">
                                <td className="py-3.5"><span className="inline-block h-2 w-36 rounded bg-white/[0.04]" /></td>
                                <td className="py-3.5"><span className="inline-block h-2 w-12 rounded bg-white/[0.04]" /></td>
                                <td className="py-3.5"><span className="inline-block h-2 w-24 rounded bg-white/[0.04]" /></td>
                                <td className="py-3.5"><span className="inline-block h-2 w-16 rounded bg-white/[0.04]" /></td>
                                <td className="py-3.5 text-right"><span className="inline-block h-2 w-14 rounded bg-white/[0.04]" /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>

                  <section id="attention" className="scroll-mt-6 rounded-[28px] border border-white/[0.09] bg-[#0f1713] p-4 shadow-[0_24px_80px_rgba(0,0,0,.18)] sm:p-6">
                    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] pb-4">
                      <div><p className="section-kicker">Needs attention</p><h2 className="section-title">The few things worth looking at</h2></div>
                      <span className="text-xs text-white/62">Signal, not alarm</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <article className="attention-card">
                        <div className="flex items-start justify-between gap-3"><StatusPill tone={asTone(snapshot.queueAttentionTone)}>Queue</StatusPill><span className="text-xs text-white/62">{snapshot.queueAttentionMeta}</span></div>
                        <h3 className="mt-4 text-base font-bold tracking-[-0.025em]">{snapshot.queueAttentionTitle}</h3>
                        <p className="mt-1.5 text-xs leading-5 text-white/72">{snapshot.queueAttentionDetail}</p>
                      </article>
                      <article className="attention-card">
                        <div className="flex items-start justify-between gap-3"><StatusPill tone={asTone(snapshot.requestsAttentionTone)}>Requests</StatusPill><span className="text-xs text-white/62">{snapshot.requestsAttentionMeta}</span></div>
                        <h3 className="mt-4 text-base font-bold tracking-[-0.025em]">{snapshot.requestsAttentionTitle}</h3>
                        <p className="mt-1.5 text-xs leading-5 text-white/72">{snapshot.requestsAttentionDetail}</p>
                      </article>
                      <article className="attention-card">
                        <div className="flex items-start justify-between gap-3"><StatusPill tone={asTone(snapshot.eventsAttentionTone)}>Events</StatusPill><span className="text-xs text-white/62">{snapshot.eventsAttentionMeta}</span></div>
                        <h3 className="mt-4 text-base font-bold tracking-[-0.025em]">{snapshot.eventsAttentionTitle}</h3>
                        <p className="mt-1.5 text-xs leading-5 text-white/72">{snapshot.eventsAttentionDetail}</p>
                      </article>
                      <article className="attention-card">
                        <div className="flex items-start justify-between gap-3"><StatusPill tone={asTone(snapshot.foodAttentionTone)}>Food data</StatusPill><span className="text-xs text-white/62">{snapshot.foodAttentionMeta}</span></div>
                        <h3 className="mt-4 text-base font-bold tracking-[-0.025em]">{snapshot.foodAttentionTitle}</h3>
                        <p className="mt-1.5 text-xs leading-5 text-white/72">{snapshot.foodAttentionDetail}</p>
                      </article>
                    </div>
                  </section>
                </div>

                <section id="operations" className="scroll-mt-6 rounded-[28px] border border-white/[0.09] bg-[#0f1713] p-4 shadow-[0_24px_80px_rgba(0,0,0,.18)] sm:p-6">
                  <div className="border-b border-white/[0.08] pb-5">
                    <p className="section-kicker">System activity</p>
                    <h2 className="section-title">Live Operations</h2>
                    <p className="mt-2 text-xs text-white/62">What Pulse Agent is doing now, what just entered, worker health, and retained terminal history in one place.</p>
                  </div>
                  <div className="mt-6 grid gap-4">
                    <div className="grid gap-3">
                      <MetricCard label="Executing now" value={String(snapshot.running)} detail={`${snapshot.queued} queued · ${snapshot.activeLeases} active leases`} tone="dark" />
                      <MetricCard label="Ingress reconciliation" value={String(snapshot.requestsAttention)} detail={`${snapshot.requestsPending} pending · ${snapshot.requestsBlank} blank`} tone="gold" />
                    </div>
                    <aside className="rounded-[26px] border border-[#69d293]/12 bg-[#113322] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,.25)]">
                      <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-white/72">Worker pulse</p><h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{snapshot.workerLabel}</h3></div><span className="mt-1 h-3 w-3 rounded-full bg-[#6bc58c] shadow-[0_0_0_5px_rgba(107,197,140,.12)]" /></div>
                      <dl className="mt-8 divide-y divide-white/10 text-sm">
                        <div className="flex justify-between gap-4 py-3"><dt className="text-white/72">Worker</dt><dd className="font-semibold">{snapshot.workerId}</dd></div>
                        <div className="flex justify-between gap-4 py-3"><dt className="text-white/72">Version</dt><dd className="font-semibold">{snapshot.workerVersion}</dd></div>
                        <div className="flex justify-between gap-4 py-3"><dt className="text-white/72">Last seen</dt><dd className="font-semibold">{snapshot.workerLastSeenLabel}</dd></div>
                        <div className="flex justify-between gap-4 py-3"><dt className="text-white/72">Spark / Gmail</dt><dd className="font-semibold text-[#98d8ae]">{snapshot.sparkGmailHealth}</dd></div>
                        <div className="flex justify-between gap-4 py-3"><dt className="text-white/72">Disk free</dt><dd className="font-semibold">{snapshot.diskFree}</dd></div>
                      </dl>
                      <p className="mt-6 rounded-2xl bg-white/8 p-4 text-xs leading-5 text-white/72">{snapshot.workerNote}</p>
                    </aside>
                    <aside className="rounded-[22px] border border-white/[0.08] bg-white/[0.035] p-5">
                      <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-white/62">Retained terminal history</p>
                      <strong className="mt-2 block text-4xl font-semibold tracking-[-0.06em]">{snapshot.retainedTerminalHistory}</strong>
                      <p className="mt-1 text-xs leading-5 text-white/72">These are completed records, not queued jobs. Current queue depth is {snapshot.queued}.</p>
                      <div className="mt-6"><Breakdown items={[{ label: 'done', value: snapshot.retainedDone, color: 'bg-[#4d9a6d]' }, { label: 'failed', value: snapshot.retainedFailed, color: 'bg-[#d77c5a]' }]} /></div>
                      <div className="mt-6 border-t border-white/[0.07] pt-5">
                        <div className="flex justify-between text-xs"><span className="text-white/62">Historical DLQ</span><strong>{snapshot.historicalDlq}</strong></div>
                        <div className="mt-3 flex justify-between text-xs"><span className="text-white/62">Archived records</span><strong>{snapshot.archivedRecords}</strong></div>
                      </div>
                    </aside>
                    <div className="border-t border-white/[0.07] pt-5">
                      <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-white/62">Provider usage</p>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 flex flex-col justify-between">
                          <p className="text-[0.8125rem] font-bold text-white/78">Gemini</p>
                          <strong className="mt-2 text-xl font-bold tracking-tight text-white/90">{snapshot.providerUsage.gemini.tasksToday}</strong>
                          <p className="mt-1 text-[0.75rem] text-white/62 truncate">{snapshot.providerUsage.gemini.status}</p>
                        </div>
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 flex flex-col justify-between">
                          <p className="text-[0.8125rem] font-bold text-white/78">DeepSeek</p>
                          <strong className="mt-2 text-xl font-bold tracking-tight text-white/90">{snapshot.providerUsage.deepseek.tasksToday}</strong>
                          <p className="mt-1 text-[0.75rem] text-white/62 truncate">{snapshot.providerUsage.deepseek.status}</p>
                        </div>
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 flex flex-col justify-between">
                          <p className="text-[0.8125rem] font-bold text-white/78">Claude</p>
                          <strong className="mt-2 text-xl font-bold tracking-tight text-white/90">{snapshot.providerUsage.claude.tasksToday}</strong>
                          <p className="mt-1 text-[0.75rem] text-white/62 truncate">{snapshot.providerUsage.claude.status}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* 2. RESEARCH LANE TAB */}
          {activeTab === 'research' && (
            <div className="space-y-12 md:mt-5">
              <section id="sheets" className="scroll-mt-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {phoneLane === null ? (() => {
                    // Nothing open: the lanes fill one screen as widgets. Pulse takes the top third, Events the middle third,
                    // and Science jobs and Deals share the bottom third side by side. Each body shows as many rows as fit.
                    const pulseState = collabCards.pulse?.state;
                    const signals = pulseState?.latestItems?.length ? pulseState.latestItems : collabCards.pulse?.topItem ? [collabCards.pulse.topItem] : [];
                    const hiddenEvents = new Set(dismissedEvents.map((e) => e.key));
                    const allEvents = asItems<EventItem>(collabCards.events.items).filter((e) => !hiddenEvents.has(eventKey(e)));
                    const events = allEvents.filter((e) => {
                      const group = groupOf(e);
                      return (homeShowCU || !CAMPUS_GROUPS.has(group)) && (homeShowConcerts || group !== 'Concerts') && (!homeFreeOnly || isFreeEvent(e.price));
                    });
                    const toggleChip = (label: string, on: boolean, flip: () => void) => (
                      <button type="button" aria-pressed={on} onClick={flip} className={`${filterChip} ${on ? 'border-[#84c4a1] bg-[#84c4a1] text-[#17231d]' : 'border-white/12 bg-white/[0.04] text-white/78'}`}>{label}</button>
                    );
                    const filterChip = 'h-7 rounded-full border px-2.5 text-[0.72rem] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70';
                    const listedRoles = asItems<RoleItem>(collabCards.jobs.items);
                    const allHomeRoles = listedRoles.length ? listedRoles : collabCards.jobs.topItem ? [collabCards.jobs.topItem as RoleItem] : [];
                    const homeJobWarning = jobPipelineWarning((collabCards.jobs.state as { pipeline?: JobPipelineStatus | null } | undefined)?.pipeline, now, true);
                    // The Jobs panel's pills share the lane's saved filters, as the Deals pills do: a kind of role
                    // (one at a time) and entry level (roles you qualify for now), which stacks with it.
                    const roles = filterRoles(allHomeRoles, jobView);
                    const jobPills: Array<{ label: string; on: boolean; flip: () => void }> = [
                      ...([['Clinical', 'Clinical research'], ['Lab', 'Lab science'], ['Earth', 'Earth & GIS']] as const).map(([label, category]) => ({
                        label, on: jobView.category === category, flip: () => patchJobView({ category: jobView.category === category ? '' : category }),
                      })),
                      { label: 'Entry', on: jobView.entryOnly, flip: () => patchJobView({ entryOnly: !jobView.entryOnly }) },
                    ];
                    const empty = (text: string) => <p className="py-1.5 text-[0.8125rem] text-white/60">{text}</p>;
                    const brief = pulseState?.morningBrief;
                    // While either brief card has grown the Pulse panel, any tap in it (other than a feed link) shrinks it
                    // back instead of opening the lane; closing the cards' <details> reports back through onToggle.
                    const shrinkPulse = (e: ReactMouseEvent<HTMLDivElement>) => {
                      if ((e.target as HTMLElement).closest('a[href]')) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const open = e.currentTarget.querySelectorAll<HTMLDetailsElement>('details[open]');
                      if (open.length) open.forEach((d) => { d.open = false; }); else setHomeBriefOpen(false);
                    };
                    const hasBrief = Boolean(brief?.sections?.bestAction || brief?.sections?.healthTraining || brief?.health || brief?.rss?.length);
                    return (
                      <nav aria-label="Lanes" className={`order-first grid min-w-0 grid-cols-2 gap-2 md:hidden ${homeBriefOpen ? 'grid-rows-[auto_18rem_18rem]' : 'h-[calc(100dvh-1rem)] min-h-[34rem] grid-rows-3'}`}>
                        <LanePreview lane="pulse" className="col-span-2" grow={homeBriefOpen || hasBrief} liftBody={hasBrief} onClickCapture={homeBriefOpen ? shrinkPulse : undefined} stat={`${collabCards.pulse?.count ?? 0} signals${collabCards.pulse?.status && collabCards.pulse.status !== 'current' ? ` · ${collabCards.pulse.status.replace('_', ' ')}` : ''}`} onOpen={() => setPhoneLane('pulse')} aside={<WeatherGlance part="now" weather={pulseState?.weather} airQuality={pulseState?.airQuality} observedAt={pulseState?.weatherObservedAt} />}>
                          {/* With a brief, its two cards take the body so they can be read from here; the hourly forecast is
                              in the lane. Without one, the forecast keeps its own open button (the body is lifted). */}
                          {!hasBrief && (
                            <button type="button" onClick={() => setPhoneLane('pulse')} aria-label="Open the Pulse lane for the full forecast" className="block w-full text-left">
                              <WeatherGlance part="hours" weather={pulseState?.weather} />
                            </button>
                          )}
                          {hasBrief ? (
                            // The body is lifted above the panel's open-the-lane tap target (liftBody), so a tap here opens the brief in place.
                            <MorningBrief brief={brief} compact onToggle={setHomeBriefOpen} />
                          ) : (
                            <ul className="mt-1.5 divide-y divide-white/[0.06]">
                              {signals.map((signal) => (
                                <PreviewRow key={signal.id} title={signal.title} detail={[signal.category, formatDenverTime(signal.publishedAt || signal.surfacedAt)].filter(Boolean).join(' · ')} />
                              ))}
                            </ul>
                          )}
                        </LanePreview>
                        <LanePreview
                          lane="events"
                          className="col-span-2"
                          stat={`${events.length} of ${allEvents.length}`}
                          onOpen={() => setPhoneLane('events')}
                          controls={<>
                            {toggleChip('CU', homeShowCU, () => setHomeShowCU((v) => !v))}
                            {toggleChip('Concerts', homeShowConcerts, () => setHomeShowConcerts((v) => !v))}
                            {toggleChip('Free', homeFreeOnly, () => setHomeFreeOnly((v) => !v))}
                          </>}
                        >
                          {events.length === 0 ? empty(allEvents.length ? 'Nothing matches these filters' : 'No upcoming events') : (
                            <ul className="divide-y divide-white/[0.06]">
                              {events.map((event) => {
                                const when = eventDay(event.start);
                                return (
                                  <PreviewRow
                                    key={eventKey(event)}
                                    lead={when && (
                                      <span className="flex w-10 shrink-0 flex-col items-center rounded-lg bg-[#84c4a1]/12 py-1 leading-none">
                                        <span className="text-[0.62rem] font-bold uppercase text-[#76d69e]">{when.dow}</span>
                                        <span className="mt-0.5 text-[0.95rem] font-bold text-white/90">{when.day}</span>
                                      </span>
                                    )}
                                    title={event.eventName}
                                    detail={[when?.time, event.venue].filter(Boolean).join(' · ')}
                                  />
                                );
                              })}
                            </ul>
                          )}
                        </LanePreview>
                        <LanePreview
                          lane="jobs"
                          bare
                          onOpen={() => setPhoneLane('jobs')}
                          controls={(
                            <div role="group" aria-label="Job filters" className="grid w-full grid-cols-2 gap-1">
                              {jobPills.map((pill) => (
                                <button key={pill.label} type="button" aria-pressed={pill.on} onClick={pill.flip} className={`${filterChip} h-7 min-w-0 whitespace-nowrap px-1 text-[0.72rem] ${pill.on ? 'border-[#8db8ee] bg-[#8db8ee] text-[#17231d]' : 'border-white/12 bg-white/[0.04] text-white/78'}`}>{pill.label}</button>
                              ))}
                            </div>
                          )}
                        >
                          {homeJobWarning && <p role="alert" className="mb-1.5 rounded-md bg-[#3b3018] px-2 py-1 text-[0.72rem] font-semibold leading-4 text-[#f0cb6d]">{homeJobWarning}</p>}
                          {roles.length === 0 ? empty(allHomeRoles.length ? 'Nothing matches these filters' : 'No apply-ready roles') : (
                            <ul className="divide-y divide-white/[0.06]">
                              {roles.map((role, index) => {
                                const stage = JOB_STAGES.find((s) => s.id === jobStages[jobKey(role)]?.stage);
                                return <PreviewRow key={`${role.employer}-${role.requisitionId || role.jobTitle}-${index}`} title={role.jobTitle} detail={stage ? <><span className="font-semibold text-[#8db8ee]">{stage.label}</span> · {role.employer}</> : role.employer} />;
                              })}
                            </ul>
                          )}
                        </LanePreview>
                        <LanePreview
                          lane="food"
                          bare
                          onOpen={() => setPhoneLane('food')}
                          controls={(
                            <div role="group" aria-label="Deal filters" className="grid w-full grid-cols-2 gap-1">
                              {GLANCE_PILLS.map((pill) => (
                                <button key={pill.id} type="button" aria-pressed={dealsGlance.isOn(pill.id)} onClick={() => dealsGlance.toggle(pill.id)} className={`${filterChip} h-7 min-w-0 whitespace-nowrap px-1 text-[0.72rem] ${dealsGlance.isOn(pill.id) ? 'border-[#f7c972] bg-[#f7c972] text-[#17231d]' : 'border-white/12 bg-white/[0.04] text-white/78'}`}>{pill.label}</button>
                              ))}
                            </div>
                          )}
                        >
                          {dealsGlance.shown.length === 0 ? empty(dealsGlance.total ? 'Nothing matches these filters' : 'No live deals') : (
                            <ul className="divide-y divide-white/[0.06]">
                              {dealsGlance.shown.map((deal) => (
                                <PreviewRow key={foodKey(deal.restaurant, deal.deal)} title={deal.restaurant} detail={<><span className="font-semibold text-[#e8c46d]">{priceTag(deal.price, deal.deal).text}</span> · {dealItem(deal.deal)}</>} wrapDetail />
                              ))}
                            </ul>
                          )}
                        </LanePreview>
                      </nav>
                    );
                  })() : null}
                  {/* The RSS feed, out of Pulse on phones: its own panel below Jobs and Deals, a scroll down from the overview. */}
                  {isPhone && phoneLane === null && asItems<RssItem>(collabCards.pulse?.items).length > 0 && (
                    <section aria-label="RSS feed" className="order-first min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-3.5 py-3 md:hidden">
                      <RssFeed items={asItems<RssItem>(collabCards.pulse?.items)} standalone />
                    </section>
                  )}
                  <article data-lane="jobs" className={`${laneCard('jobs')}${phoneHidden('jobs')}`}>
                    {(() => {
                      const jobStats = collabCards.jobs.stats ?? {};
                      const listedRoles = asItems<RoleItem>(collabCards.jobs.items);
                      const unfilteredRoles = listedRoles.length ? listedRoles : collabCards.jobs.topItem ? [collabCards.jobs.topItem as RoleItem] : [];
                      const trackedRoles = unfilteredRoles.filter((r) => r.tracked).length;
                      const openRoles = unfilteredRoles.length - trackedRoles;
                      const allRoles = filterRoles(unfilteredRoles, jobView);
                      const roles = allRoles.slice(0, 8);
                      const jobsCheckedAt = (collabCards.jobs.state as { checkedAt?: string } | undefined)?.checkedAt;
                      const jobFilterBar = <JobFilterBar roles={unfilteredRoles} view={jobView} onChange={patchJobView} checkedAt={jobsCheckedAt} />;
                      const noRoles = unfilteredRoles.length > 0 ? (
                        <p className="mt-3 text-xs leading-5 text-white/72">
                          No roles match {describeJobFilters(jobView)}.{' '}
                          <button type="button" onClick={() => patchJobView(CLEAR_JOB_FILTERS)} className="font-bold text-[#8db8ee] hover:underline">Clear filters</button>
                        </p>
                      ) : <p className="mt-2 text-xs leading-5 text-white/72">No apply-ready roles right now.</p>;
                      // One role row, shared by the card (top 8) and the full-screen panel (every role, in columns).
                      const roleItem = (role: RoleItem, index: number, cols: boolean) => {
                        const href = safeUrl(role.url);
                        const due = role.deadline && role.deadline.toLowerCase() !== 'rolling' ? role.deadline : '';
                        return (
                            <li key={`${role.employer}-${role.requisitionId || role.jobTitle}-${index}`} className={cols ? 'border-b border-white/[0.06] py-2.5' : 'py-2.5 first:pt-1 last:pb-0'}>
                              <div className="flex items-start gap-2">
                                {role.applyOrder && <span className="mt-0.5 shrink-0 rounded bg-[#8eabd2]/15 px-1.5 py-0.5 font-mono text-[0.75rem] font-bold text-[#8db8ee]">#{role.applyOrder}</span>}
                                <div className="min-w-0 flex-1">
                                  <h4 className="text-[0.875rem] font-bold leading-snug">
                                    {href ? <a href={href} target="_blank" rel="noreferrer" className="hover:underline focus-visible:underline">{role.jobTitle}</a> : role.jobTitle}
                                  </h4>
                                  <p className="mt-0.5 text-[0.8125rem] text-white/72">{[role.employer, role.location].filter(Boolean).join(' · ')}</p>
                                  <p className="mt-1 text-[0.75rem] leading-4 text-white/72">
                                    {[role.salary && role.salary !== 'Not specified' ? role.salary : '', role.fitScore ? `Fit ${role.fitScore}` : '', role.applicationTier].filter(Boolean).join(' · ')}
                                    {due && <span className="text-[#f0cb6d]"> · Due {due}</span>}
                                  </p>
                                  {role.nextAction && <p className="mt-1 text-[0.8125rem] text-white/78">{role.nextAction}</p>}
                                  {(() => {
                                    const key = jobKey(role);
                                    const current = jobStages[key];
                                    const currentStage = JOB_STAGES.find((s) => s.id === current?.stage);
                                    const picking = pickingJob === key;
                                    const chip = 'rounded-full px-2.5 py-1 text-[0.75rem] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f7c972]';
                                    return (
                                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => setPickingJob(picking ? null : key)}
                                          aria-expanded={picking}
                                          aria-label={`Application stage for ${role.jobTitle}: ${currentStage ? currentStage.label : 'not tracked'}`}
                                          title={current ? `${currentStage?.label} since ${formatDenverTime(current.at)}` : 'Track this application'}
                                          className={`${chip} ${currentStage ? currentStage.on : 'border border-dashed border-white/25 text-white/72 hover:border-white/45 hover:text-white'}`}
                                        >
                                          {currentStage ? currentStage.label : '+ Track'} <span aria-hidden="true" className="text-white/62">{picking ? '▴' : '▾'}</span>
                                        </button>
                                        {picking && JOB_STAGES.map((s) => (
                                          <button key={s.id} type="button" onClick={() => setJobStage(key, s.id)} aria-pressed={current?.stage === s.id}
                                            className={`${chip} ${current?.stage === s.id ? `${s.on} ring-1 ring-white/30` : 'bg-white/[0.06] text-white/78 hover:bg-white/[0.12]'}`}>
                                            {s.label}
                                          </button>
                                        ))}
                                        {picking && current && <span className="text-[0.75rem] text-white/62">Tap the current stage to clear</span>}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </li>
                        );
                      };
                      const statLine = (
                        <StatLine items={[[collabCards.jobs.count, 'tracked roles'], [jobStats.applyNow ?? 0, 'apply now'], ...(['applied', 'interviewing', 'offer'] as const).flatMap((id) => {
                          const n = unfilteredRoles.filter((r) => jobStages[jobKey(r)]?.stage === id).length;
                          return n ? [[n, id] as StatItem] : [];
                        }), ...(jobStats.verifiedLive !== undefined ? [[jobStats.verifiedLive ?? 0, 'verified live'], [jobStats.provisional ?? 0, 'provisional'], [jobStats.expired ?? 0, 'expired']] as StatItem[] : [])]} />
                      );
                      const notice = jobNotice && <p role="status" className="mt-3 text-[0.8125rem] leading-4 text-white/62">{jobNotice}</p>;
                      const pipelineWarning = jobPipelineWarning((collabCards.jobs.state as { pipeline?: JobPipelineStatus | null } | undefined)?.pipeline, now);
                      const pipelineAlert = pipelineWarning && <p role="alert" className="mt-4 rounded-lg bg-[#3b3018] px-3 py-2 text-[0.8125rem] font-semibold leading-5 text-[#f0cb6d]">{pipelineWarning}</p>;
                      return (
                        <>
                          <div className="flex items-center gap-2 md:gap-3"><LaneIcon lane="jobs" expanded={panel?.lane === 'jobs'} onToggle={(button) => toggleLane('jobs', button)} fixed={isPhone} /><h3 title="Job pipeline · Science Jobs tab" className="min-w-0 flex-1 truncate text-lg font-semibold md:text-xl tracking-[-0.04em]"><span className="md:hidden">Jobs</span><span className="max-md:hidden">Science jobs</span></h3>{phoneControls('jobs', 'Science jobs')}</div>
                          {pipelineAlert}
                          <div className="lane-wide mt-5 border-t border-white/[0.07] pt-4">
                            {jobFilterBar}
                            {roles.length === 0 ? noRoles : (
                              <ul className="mt-2 divide-y divide-white/[0.06]">{(isPhone ? allRoles : roles).map((role, index) => roleItem(role, index, false))}</ul>
                            )}
                          </div>
                          {statLine}
                          {notice}
                          <p className="card-footnote text-[0.8125rem] leading-4 text-white/62">{isPhone ? `Showing ${openRoles} of ${jobStats.applyNow ?? openRoles} apply-ready roles, in tracker order${trackedRoles ? `, then ${trackedRoles} you are tracking` : ''}. Superseded copy intentionally excluded.` : <>Top {roles.filter((r) => !r.tracked).length} of {jobStats.applyNow ?? roles.length} apply-ready roles, in tracker order. Superseded copy intentionally excluded.</>}</p>
                          {sheetLink(sourceLinks.jobs)}
                          {panel?.lane === 'jobs' && (
                            <LanePanel lane="jobs" title="Science jobs" origin={panel} onClose={closePanel}>
                              {pipelineAlert}
                              <div className="mt-5 border-t border-white/[0.07] pt-4">
                                {jobFilterBar}
                                {allRoles.length === 0 ? noRoles : (
                                  <ul className="lane-rows mt-2">{allRoles.map((role, index) => roleItem(role, index, true))}</ul>
                                )}
                              </div>
                              {statLine}
                              {notice}
                              <p className="mt-5 text-[0.8125rem] leading-4 text-white/62">Showing {openRoles} of {jobStats.applyNow ?? openRoles} apply-ready roles, in tracker order{trackedRoles ? `, then ${trackedRoles} you are tracking` : ''}. Superseded copy intentionally excluded.</p>
                              {sheetLink(sourceLinks.jobs)}
                            </LanePanel>
                          )}
                        </>
                      );
                    })()}
                  </article>

                  <article ref={dealsCard} data-lane="food" className={`${laneCard('food')}${phoneHidden('food')}`}>
                    {(() => {
                      const foodStats = collabCards.food.stats ?? {};
                      const foodTop = collabCards.food.topItem;
                      const allFood = asItems<FoodItem>(collabCards.food.items);
                      const listed = allFood.filter((d) => isDealLive(d, rockiesYesterday, denverClock));
                      // The top deal stands in only for a snapshot with no item list, not for a list with nothing on right now.
                      const foodItems = allFood.length ? listed : foodTop ? [{ kind: 'verified' as const, restaurant: foodTop.restaurant, deal: foodTop.deal, price: foodTop.price, discount: foodTop.netDiscount || foodTop.discountPercent, location: foodTop.location, validThrough: foodTop.validThrough, orderSource: foodTop.orderSource }] : [];
                      const hidden = new Set(dismissedFood.map((e) => e.key));
                      const isShown = (item: FoodItem) => !hidden.has(foodKey(item.restaurant, item.deal));
                      const verifiedAll = foodItems.filter((item) => item.kind !== 'recurring' && isShown(item));
                      const recurringAll = foodItems.filter((item) => item.kind === 'recurring' && isShown(item));
                      // Everything under the list, shared by the card and the full-screen panel.
                      const dealsRest = (
                        <>
                          <GearWatch items={asItems<GearItem>(collabCards.food.gear)} />
                          {(() => {
                            const localOnly = dismissedFood.filter((e) => !e.synced).length;
                            return (localOnly > 0 || foodNotice) && (
                              <p className="mt-4 text-[0.8125rem] leading-4 text-white/62">
                                {foodNotice || `${localOnly} hidden on this device only`}
                                {localOnly > 0 && <> · <button type="button" onClick={() => { saveDismissedFood(dismissedFood.filter((e) => e.synced)); setFoodNotice(''); }} className="font-bold text-[#e8c46d] hover:underline">Restore</button></>}
                              </p>
                            );
                          })()}
                          <DismissedList
                            label="deals"
                            accent="gold"
                            rows={(sheetDismissedFood ?? []).map((item) => ({ key: foodKey(item.restaurant, item.deal), title: item.restaurant, detail: [item.deal, item.price].filter(Boolean).join(' · ') }))}
                            restoringKey={restoringFood}
                            onRestore={(key) => { const item = sheetDismissedFood?.find((d) => foodKey(d.restaurant, d.deal) === key); if (item) void restoreFood(item); }}
                          />
                          <StatLine items={[[collabCards.food.count, 'live deals'], [foodStats.liveVerified ?? verifiedAll.length, 'verified now'], ...(foodStats.liveRecurring !== undefined ? [[foodStats.liveRecurring ?? 0, 'recurring'], [foodStats.expiredHistory ?? 0, 'expired history']] as StatItem[] : [])]} />
                          <p className="card-footnote text-[0.8125rem] leading-4 text-white/62">Candidate pipeline: {foodStats.candidateBacklog ?? 0} awaiting review · {foodStats.verified ?? 0} verified · {foodStats.rejected ?? 0} rejected. Expired and inactive rows are counted as history, not live deals.</p>
                          {sheetLink(sourceLinks.food)}
                        </>
                      );
                      return (
                        <>
                          <div className="flex items-center gap-2 md:gap-3"><LaneIcon lane="food" expanded={panel?.lane === 'food'} onToggle={(button) => toggleLane('food', button)} fixed={isPhone} /><h3 title="Denver Food Deal Collaboration" className="min-w-0 flex-1 truncate text-lg font-semibold md:text-xl tracking-[-0.04em]">Deals</h3>{phoneControls('food', 'Deals')}</div>
                          <FoodDeals verified={verifiedAll} recurring={recurringAll} expanded={isPhone} onDismiss={(item) => void dismissFood(item)} onExpand={() => toggleLane('food', dealsCard.current?.querySelector<HTMLElement>('button[aria-expanded]') ?? undefined)} />
                          {dealsRest}
                          {panel?.lane === 'food' && (
                            <LanePanel lane="food" title="Deals" origin={panel} onClose={closePanel}>
                              <FoodDeals verified={verifiedAll} recurring={recurringAll} expanded onDismiss={(item) => void dismissFood(item)} onExpand={closePanel} />
                              {dealsRest}
                            </LanePanel>
                          )}
                        </>
                      );
                    })()}
                  </article>

                  <article data-lane="events" className={`${laneCard('events')}${phoneHidden('events')}`}>
                    {(() => {
                      const eventStats = collabCards.events.stats ?? {};
                      const hiddenEvents = new Set(dismissedEvents.map((e) => e.key));
                      const upcoming = asItems<EventItem>(collabCards.events.items).filter((e) => !hiddenEvents.has(eventKey(e)));
                      const localOnlyEvents = dismissedEvents.filter((e) => !e.synced).length;
                      const topEvent = collabCards.events.topItem;
                      return (
                        <>
                          <div className="flex items-center gap-2 md:gap-3"><LaneIcon lane="events" expanded={expandedLane === 'events'} onToggle={() => toggleLane('events')} fixed={isPhone} /><h3 title="Denver Event Ledger" className="min-w-0 flex-1 truncate text-lg font-semibold md:text-xl tracking-[-0.04em]">Events</h3>{phoneControls('events', 'Events')}</div>
                          {topEvent && (
                            <div className="mt-5 rounded-2xl border border-[#84c4a1]/10 bg-[#102019] p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-[#76d69e]">Top triage recommendation</p>
                                {topEvent.approvalState && <StatusPill tone="warning">{topEvent.approvalState}</StatusPill>}
                              </div>
                              <h4 className="mt-2 text-sm font-bold">{topEvent.eventName}</h4>
                              {topEvent.whyItMadeTheCut && <p className="mt-1 text-xs leading-5 text-white/72">{topEvent.whyItMadeTheCut}</p>}
                              <p className="mt-2 text-[0.8125rem] text-white/72">{[formatEventStart(topEvent.start), topEvent.ticketRsvpUrgency, topEvent.calendarAction].filter(Boolean).join(' · ')}</p>
                            </div>
                          )}
                          <UpcomingEvents items={upcoming} expanded={wide('events')} onDismiss={(event) => void dismissEvent(event)} />
                          {(localOnlyEvents > 0 || eventNotice) && (
                            <p className="mt-4 text-[0.8125rem] leading-4 text-white/62">
                              {eventNotice || `${localOnlyEvents} hidden on this device only`}
                              {localOnlyEvents > 0 && <> · <button type="button" onClick={() => { saveDismissedEvents(dismissedEvents.filter((e) => e.synced)); setEventNotice(''); }} className="font-bold text-[#76d69e] hover:underline">Restore</button></>}
                            </p>
                          )}
                          <DismissedList
                            label="events"
                            accent="green"
                            rows={(sheetDismissed ?? []).map((item) => ({ key: eventKey(item), title: item.eventName, detail: [formatEventStart(item.start), item.venue].filter(Boolean).join(' · ') }))}
                            restoringKey={restoringEvent}
                            onRestore={(key) => { const item = sheetDismissed?.find((e) => eventKey(e) === key); if (item) void restoreEvent(item); }}
                          />
                          <StatLine items={[[collabCards.events.count, 'logged events'], [eventStats.next24 ?? 0, 'next 24 hours'], ...(eventStats.calendarCandidates !== undefined ? [[eventStats.calendarCandidates ?? 0, 'calendar candidates'], [eventStats.watch ?? 0, 'watch']] as StatItem[] : []), ...(eventStats.next7 !== undefined ? [[eventStats.next7, 'start within 7 days']] as StatItem[] : []), ...((eventStats.proposalsPending ?? 0) > 0 ? [[eventStats.proposalsPending, 'proposals awaiting approval']] as StatItem[] : [])]} />
                          <p className="card-footnote text-[0.8125rem] leading-4 text-white/62">Next {upcoming.length} of {eventStats.upcoming ?? collabCards.events.count} upcoming, soonest first. “Propose” never means added to Calendar.</p>
                          {sheetLink(sourceLinks.events)}
                        </>
                      );
                    })()}
                  </article>

                  <article data-lane="pulse" className={`${laneCard('pulse')}${phoneHidden('pulse')}`}>
                    <div className="flex items-center gap-2 md:gap-3">
                      <LaneIcon lane="pulse" expanded={expandedLane === 'pulse'} onToggle={() => toggleLane('pulse')} fixed={isPhone} />
                      <h3 title="Subsystem Intelligence" className="min-w-0 flex-1 truncate text-lg font-semibold md:text-xl tracking-[-0.04em]">Pulse</h3>
                      {/* Only worth a pill when something is off; a current Pulse says nothing. */}
                      {collabCards.pulse?.status !== 'current' && (
                        <StatusPill tone={collabCards.pulse?.status === 'failed' || collabCards.pulse?.status === 'offline' ? 'danger' : collabCards.pulse?.status === 'stale' ? 'warning' : 'neutral'}>
                          {(collabCards.pulse?.status || 'not_run').toUpperCase()}
                        </StatusPill>
                      )}
                      {phoneControls('pulse', 'Pulse')}
                    </div>
                    {(() => {
                      const pulseState = collabCards.pulse?.state;
                      const signals = pulseState?.latestItems?.length ? pulseState.latestItems : collabCards.pulse?.topItem ? [collabCards.pulse.topItem] : [];
                      const recapItems = pulseState?.dailyRecap?.sections?.flatMap((section) => section.items) ?? [];
                      const rssItems = asItems<RssItem>(collabCards.pulse?.items);
                      const linkClass = 'hover:underline focus-visible:underline';
                      const pulseWide = !isPhone && wide('pulse');
                      const signalRow = (key: string, category: string | null | undefined, when: string, title: string, url: string | null | undefined, summary: string | null | undefined) => {
                        const href = safeUrl(url);
                        return (
                          <li key={key} className="py-2.5 first:pt-1 last:pb-0">
                            <div className="flex items-center justify-between gap-2">
                              {category ? <span className="rounded bg-[#f472b6]/20 px-1.5 py-0.5 text-[0.72rem] font-bold uppercase text-[#fbcfe8]">{category}</span> : <span />}
                              <span className="text-[0.75rem] text-white/62">{when}</span>
                            </div>
                            <h4 className="mt-1.5 text-sm font-bold leading-snug">
                              {href ? <a href={href} target="_blank" rel="noreferrer" className={linkClass}>{title}</a> : title}
                            </h4>
                            {summary && <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/72">{summary}</p>}
                          </li>
                        );
                      };
                      const signalList = (
                        <div className={`${pulseWide ? '' : 'lane-wide '}mt-5 border-t border-white/[0.07] pt-4`}>
                          {signals.length === 0 ? (
                            <p className="mt-2 text-xs leading-5 text-white/72">No hourly findings recorded in snapshot.</p>
                          ) : (
                            <ul className={`mt-2 divide-y divide-white/[0.06] ${wide('pulse') && !pulseWide ? 'lane-cols' : ''}`}>
                              {signals.map((signal) => signalRow(signal.id, signal.category, formatDenverTime(signal.publishedAt || signal.surfacedAt), signal.title, signal.url, signal.summary))}
                            </ul>
                          )}
                        </div>
                      );
                      // The daily recap reads like the signals above it: same chip, headline and summary, so the two lists look like one.
                      const recapList = recapItems.length > 0 && (
                        <div className="mt-5 border-t border-white/[0.07] pt-4">
                          <ul className={`mt-2 divide-y divide-white/[0.06] ${wide('pulse') && !pulseWide ? 'lane-cols' : ''}`}>
                            {recapItems.map((item) => signalRow(item.title, 'Daily recap', '', item.title, item.url, item.summary))}
                          </ul>
                        </div>
                      );
                      return (
                        <>
                          {/* Expanded on a desktop: conditions with the picked signals and the daily recap under them on the left; the workout and
                              feed rundown side by side on the right, with the RSS feed filling the space beneath them. */}
                          <div className={pulseWide ? 'lane-wide grid items-start gap-x-6 md:grid-cols-2 xl:grid-cols-3' : ''}>
                            <div className={pulseWide ? 'min-w-0' : ''}>
                          {(pulseState?.weather || pulseState?.airQuality) && (
                            <ConditionsCard
                              weather={pulseState?.weather}
                              airQuality={pulseState?.airQuality}
                              observedAt={pulseState?.weatherObservedAt}
                              expanded={!isPhone && expandedLane === 'pulse'}
                              onClose={isPhone ? () => setPhoneLane(null) : undefined}
                              observed={formatDenverTime(pulseState?.weatherObservedAt) ? `Observed ${formatDenverTime(pulseState?.weatherObservedAt)}${pulseState?.weatherProvider ? ` · ${pulseState.weatherProvider}` : ''}` : ''}
                            />
                          )}
                          {/* What to wear today follows the forecast, so it sits right under the conditions. */}
                          <ScentCard highF={(() => { const w = parseWeather(pulseState?.weather); return w ? (w.high ?? w.temp) : null; })()} />
                          {!pulseWide && <MorningBrief brief={pulseState?.morningBrief} />}
                          {pulseWide && signalList}
                          {pulseWide && recapList}
                            </div>
                            {pulseWide && (
                              <div className="grid min-w-0 items-start gap-x-6 xl:col-span-2 xl:grid-cols-2">
                                <MorningBrief brief={pulseState?.morningBrief} wide />
                                {rssItems.length > 0 && <div className="min-w-0 xl:col-span-2"><RssFeed items={rssItems} below /></div>}
                              </div>
                            )}
                          </div>
                          {!pulseWide && signalList}
                          {!pulseWide && recapList}
                        </>
                      );
                    })()}
                    <StatLine items={[[collabCards.pulse?.count ?? 0, 'signals surfaced'], [collabCards.pulse?.stats?.morningDelivered ? 'Delivered' : 'Pending', 'morning brief']]} />
                    <p className="card-footnote text-[0.8125rem] leading-4 text-white/62">
                      {collabCards.pulse?.stats?.dailyRecapAvailable ? 'Daily recap available.' : 'Daily recap generates at 11:05 PM.'}
                      {formatDenverTime(collabCards.pulse?.state?.lastSuccessfulPulseRun) ? ` Last successful run ${formatDenverTime(collabCards.pulse?.state?.lastSuccessfulPulseRun)}.` : ''}
                    </p>
                  </article>
                </div>
              </section>
            </div>
          )}

          {/* 3. SOURCES TAB */}
          {activeTab === 'sources' && (
            <div className="mt-8">
              <section id="sources" className="scroll-mt-6">
                <div className="mb-5"><p className="section-kicker">Source freshness</p><h2 className="section-title">What “current” means here</h2></div>
                <div className="overflow-hidden rounded-[24px] border border-white/[0.09] bg-[#0f1713] shadow-[0_24px_80px_rgba(0,0,0,.14)]">
                  <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/[0.07] px-5 py-4 sm:grid-cols-[1.5fr_1fr_auto]">
                    <div><p className="text-sm font-bold">LeviAgentQueue</p><p className="mt-0.5 text-xs text-white/62">Native Google Sheet · worker heartbeat included</p></div><p className="hidden self-center text-xs text-white/72 sm:block">Snapshot {snapshot.updatedLabel}</p><SourceButton href={sourceLinks.queue}>Live source</SourceButton>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/[0.07] px-5 py-4 sm:grid-cols-[1.5fr_1fr_auto]">
                    <div><p className="text-sm font-bold">Denver Food Deal Collaboration</p><p className="mt-0.5 text-xs text-white/62">Native Google Sheet · verified-state counts</p></div><p className="hidden self-center text-xs text-white/72 sm:block">Checked {snapshot.updatedLabel}</p><SourceButton href={sourceLinks.food}>Live source</SourceButton>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/[0.07] px-5 py-4 sm:grid-cols-[1.5fr_1fr_auto]">
                    <div><p className="text-sm font-bold">Denver Event Ledger</p><p className="mt-0.5 text-xs text-white/62">Native Google Sheet · time-sensitive snapshot</p></div><p className="hidden self-center text-xs text-white/72 sm:block">Checked {snapshot.updatedLabel}</p><SourceButton href={sourceLinks.events}>Live source</SourceButton>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-3 px-5 py-4 sm:grid-cols-[1.5fr_1fr_auto]">
                    <div><p className="text-sm font-bold">Science Jobs (job pipeline)</p><p className="mt-0.5 text-xs text-white/62">Native Google Sheet · refreshed daily by the job pipeline</p></div><p className="hidden self-center text-xs text-white/72 sm:block">Checked {snapshot.updatedLabel}</p><SourceButton href={sourceLinks.jobs}>Live source</SourceButton>
                  </div>
                </div>

                <div className="mt-4 rounded-[22px] border border-[#70d59b]/10 bg-[#0f2118] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
                  <div className="max-w-3xl"><p className="text-sm font-bold">Private by design</p><p className="mt-1 text-xs leading-5 text-white/72">This site carries a bounded snapshot and safe queue fields. It does not expose the existing Google service-account key, which can write to two sources. The buttons above take you to the authenticated live files.</p></div>
                  <StatusPill tone="success">Credentials stay local</StatusPill>
                </div>
              </section>
            </div>
          )}

          <footer className="mt-12 flex flex-col gap-6 border-t border-white/[0.08] pt-6">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#1a4933] text-xs font-black text-[#f7c972]">P</span>
                  <div><p className="text-sm font-bold">Pulse Ops</p><p className="text-[0.75rem] text-white/62 lg:hidden">{isLive ? 'Live dashboard feed' : 'Private snapshot'}</p><p className="hidden text-[0.75rem] text-white/62 lg:block">Command center</p></div>
                </div>
                <div className="hidden items-center gap-3 lg:flex">
                  <FeedClock isLive={isLive} updatedAt={snapshot.updatedAt} lastCheckedAt={lastCheckedAt} />
                </div>
              </div>
              <SourceButton href={sourceLinks.queue}>Open live queue</SourceButton>
            </div>
            <div className="flex flex-col gap-2 border-t border-white/[0.08] pt-6 text-[0.8125rem] text-white/62 sm:flex-row sm:items-center sm:justify-between">
              <p>Pulse Ops · owner-only operations snapshot</p>
              <p>Captured {snapshot.updatedLabel}</p>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
