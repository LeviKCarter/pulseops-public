import json, os, time, re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SPREADSHEET_ID = 'YOUR_QUEUE_SPREADSHEET_ID'
FOOD_SPREADSHEET_ID = 'YOUR_FOOD_SPREADSHEET_ID'
EVENTS_SPREADSHEET_ID = 'YOUR_EVENTS_SPREADSHEET_ID'
JOBS_SPREADSHEET_ID = 'YOUR_JOB_TRACKER_SPREADSHEET_ID'

CREDS = Path(r'C:\Users\YOU\AppData\Local\LeviAgent\google-service-account.json')
DENVER = ZoneInfo('America/Denver')
SITE = Path(__file__).resolve().parents[1]
OUT = SITE / 'app' / 'queueSnapshot.ts'
# The folder the live dashboard (:3000 and the phone app) runs from. Only a run from here writes the 'Site Snapshot'
# sheet and pushes the live feed: a session worktree on older code once pushed the old deal format over a fresh
# deploy, and the sheet is what push_live_snapshot.py relays, so a stale sheet write undoes a deploy as surely as a
# stale push. Runs anywhere else still regenerate their own app/queueSnapshot.ts for previews.
LIVE_SITE = Path(r'C:\Users\YOU\Documents\Codex\LeviOps-V11-6026-v10')

def is_live_folder(site=SITE):
    return os.path.normcase(os.path.realpath(site)) == os.path.normcase(os.path.realpath(LIVE_SITE))

# Two live runs at once (the 15-minute task and a deploy's refresh, say) clear and rewrite the same sheet range, and
# one then fails its read-back with SITE_SNAPSHOT_VERIFY_FAILED or pushes the other's half-written rows. The sheet
# write and the push that relays it run under this machine-wide lock. It is an OS lock on the file, so Windows drops
# it when the holder exits, even on a crash, and a leftover file never blocks anyone.
SNAPSHOT_LOCK = Path(os.environ.get('LOCALAPPDATA', r'C:\Users\YOU\AppData\Local')) / 'LeviAgent' / 'leviops-snapshot.lock'
SNAPSHOT_LOCK_WAIT_SECONDS = 45  # a whole refresh takes ~10 s, so this outlasts any holder that is still healthy

class SnapshotLocked(RuntimeError):
    pass

class snapshot_lock:
    def __init__(self, path=SNAPSHOT_LOCK, wait=SNAPSHOT_LOCK_WAIT_SECONDS):
        self.path, self.wait, self.fh = Path(path), wait, None

    def __enter__(self):
        import msvcrt
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.path, 'a+b')
        deadline = time.monotonic() + self.wait
        while True:
            try:
                self.fh.seek(0); msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
                return self
            except OSError:
                if time.monotonic() >= deadline:
                    self.fh.close(); self.fh = None
                    raise SnapshotLocked(f'another snapshot refresh held {self.path} for {self.wait}s')
                time.sleep(0.5)

    def __exit__(self, *exc):
        import msvcrt
        try:
            self.fh.seek(0); msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            self.fh.close(); self.fh = None
        return False
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

def parse_rows(vals):
    if not vals: return []
    h = vals[0]
    return [dict(zip(h, r + [''] * max(0, len(h) - len(r)))) for r in vals[1:] if r and str(r[0]).strip()]

def fetch_all(service):
    for attempt in range(6):
        try:
            resp = service.spreadsheets().values().batchGet(
                spreadsheetId=SPREADSHEET_ID,
                ranges=['Queue!A:AP', 'Archive!A:AP', 'Requests!A:J', 'Worker!A:N', 'DLQ!A:AP']
            ).execute()
            vrs = resp.get('valueRanges', [])
            return tuple(parse_rows(vr.get('values', [])) for vr in vrs)
        except Exception as e:
            if '429' in str(e) and attempt < 5:
                time.sleep(min(15, 2 ** (attempt + 1)))
                continue
            raise

def fetch_health_state(service):
    vals = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID, range="'Health'!A1:I10"
    ).execute().get('values', [])
    state = {}
    for row in vals:
        for idx in (0, 2, 4, 7):
            if len(row) <= idx: continue
            key = str(row[idx]).strip()
            if not key or key.startswith('==='): continue
            val = str(row[idx + 1]).strip() if len(row) > idx + 1 else ''
            state[key] = val
    return state


def dt(v):
    if not v: return 0.0
    try: return datetime.fromisoformat(str(v).replace('Z', '+00:00')).timestamp()
    except: return 0.0

def when(r):
    return dt(r.get('finished_at') or r.get('started_at') or r.get('created_at'))

def clock(v):
    if not v: return '\u2014'
    try:
        d = datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        if d.tzinfo is not None: d = d.astimezone()
        return d.strftime('%I:%M:%S %p').lstrip('0')
    except: return '\u2014'

def eng(v):
    x = (v or '').strip()
    return {'powershell': 'PowerShell', 'python': 'Python', 'agy': 'Antigravity'}.get(x.lower(), x or '\u2014')

def ds(s):
    return {'done': 'Done', 'failed': 'Failed', 'cancelled': 'Cancelled', 'running': 'Running', 'queued': 'Queued'}.get((s or '').lower(), (s or 'Unknown').title())

def tone(s):
    return {'done': 'success', 'failed': 'danger', 'cancelled': 'neutral', 'running': 'warning', 'queued': 'warning'}.get((s or '').lower(), 'neutral')

def count_nonblank(values):
    count = 0
    for row in values:
        if row and any(str(cell).strip() for cell in row):
            count += 1
    return count

def clip(text, limit):
    """Trim long sheet text for the dashboard lists so the snapshot cell stays small."""
    t = ' '.join(str(text or '').split())
    return t if len(t) <= limit else t[:limit - 1].rstrip() + '\u2026'

def food_item(row, kind):
    discount = row.get('netDiscount') or row.get('discountPercent') or row.get('discount') or ''
    source = str(row.get('orderSource') or '').strip()
    return {'kind': kind, 'restaurant': clip(row.get('restaurant'), 60), 'deal': clip(row.get('deal'), 150), 'price': clip(row.get('price'), 70),
            'discount': clip(discount, 80), 'location': clip(row.get('location'), 70), 'validThrough': clip(row.get('validThrough'), 90),
            'orderSource': source if source.lower().startswith('http') and len(source) <= 300 else '',
            'svc': food_services(row.get('deal'), row.get('price'), row.get('validThrough'), row.get('verification'), row.get('notes')),
            'type': food_type(row.get('deal'), row.get('restaurant')),
            **({'when': when} if (when := deal_schedule(row.get('deal'), row.get('validThrough'), datetime.now(DENVER).year)) else {})}

def find_header_row_and_map(values, required_keywords):
    for idx, row in enumerate(values):
        row_str = ' '.join(str(c).lower() for c in row)
        if all(kw.lower() in row_str for kw in required_keywords):
            return idx, [str(c).strip() for c in row]
    for idx, row in enumerate(values):
        if row and any(str(c).strip() for c in row):
            return idx, [str(c).strip() for c in row]
    return 0, []

def parse_event_start(text, tz):
    """Parse an Events/Daily Triage start cell. Returns (aware datetime, has_time) or (None, False).

    The ledger writes 'YYYY-MM-DD H:MM AM/PM' (Denver time) or a bare 'YYYY-MM-DD' for all-day events;
    ISO strings are accepted too. datetime.fromisoformat alone rejects the ledger's own format.
    """
    s = str(text or '').strip()
    if not s: return None, False
    for fmt, has_time in (('%Y-%m-%d %I:%M %p', True), ('%Y-%m-%d', False)):
        try: return datetime.strptime(s, fmt).replace(tzinfo=tz), has_time
        except ValueError: pass
    try:
        d = datetime.fromisoformat(s.replace('Z', '+00:00'))
        return (d if d.tzinfo else d.replace(tzinfo=tz)), True
    except ValueError:
        return None, False

def is_upcoming(text, now):
    """True unless the start is parseable and already over (all-day events count through the end of their day)."""
    d, has_time = parse_event_start(text, now.tzinfo)
    if d is None: return True
    if not has_time: d = d.replace(hour=23, minute=59, second=59)
    return d >= now

def parse_rank_num(val):
    if not val: return 999999.0
    m = re.search(r'[-+]?\d*\.?\d+', str(val))
    if m:
        try: return float(m.group(0))
        except: pass
    return 999999.0

def gear_watch(values):
    """Latest Gear Deals check per product and seller. The gear watch appends a row per seller each day, so older rows are price history."""
    latest = {}
    for row in values[1:]:
        cell = lambda i: str(row[i]).strip() if len(row) > i else ''
        if not cell(1) or not cell(2): continue
        key = (cell(1), cell(2))
        if key not in latest or cell(0) >= latest[key][0]:
            latest[key] = (cell(0), row)
    out = []
    for (product, seller), (checked, row) in sorted(latest.items()):
        cell = lambda i: str(row[i]).strip() if len(row) > i else ''
        link = cell(6)
        out.append({'product': clip(product, 90), 'seller': clip(seller, 50), 'price': clip(cell(3), 90), 'stock': clip(cell(4), 70),
                    'alert': cell(5).upper() == 'YES', 'url': link if link.lower().startswith('http') and len(link) <= 300 else '',
                    'checkedAt': checked, 'notes': clip(cell(7), 200)})
    return out

def fetch_food_collab(service):
    for attempt in range(6):
        try:
            resp = service.spreadsheets().values().batchGet(
                spreadsheetId=FOOD_SPREADSHEET_ID,
                ranges=["'Verified Deals'!A2:L", "'Recurring Deals'!A2:L", "'Quick View'!A1:Z25", "'Spark Candidates'!A1:I", "'Gear Deals'!A1:H"]
            ).execute()
            vrs = resp.get('valueRanges', [])
            v_vals = vrs[0].get('values', []) if len(vrs) > 0 else []
            r_vals = vrs[1].get('values', []) if len(vrs) > 1 else []
            qv_vals = vrs[2].get('values', []) if len(vrs) > 2 else []
            cand_vals = vrs[3].get('values', []) if len(vrs) > 3 else []
            gear_vals = vrs[4].get('values', []) if len(vrs) > 4 else []
            # Column B is the restaurant and column L the status. EXPIRED / INACTIVE / DISMISSED rows stay in the sheet as history,
            # so they are not live deals.
            def _live(rows): return [r for r in rows if len(r) > 1 and str(r[1]).strip() and (str(r[11]).strip().upper() if len(r) > 11 else '') not in ('EXPIRED', 'INACTIVE', 'DISMISSED')]
            live_verified, live_recurring = _live(v_vals), _live(r_vals)
            total_count = len(live_verified) + len(live_recurring)
            history_count = count_nonblank(v_vals) + count_nonblank(r_vals) - total_count

            h_idx, headers = find_header_row_and_map(qv_vals, ['restaurant'])
            header_map = {}
            for col_idx, h in enumerate(headers):
                norm = h.lower().replace('_', ' ').replace('\n', ' ').strip()
                if 'restaurant' in norm: header_map['restaurant'] = col_idx
                elif norm in ('deal', 'deal description', 'promotion') or 'deal' in norm:
                    if 'restaurant' not in norm and 'net discount' not in norm and 'discount' not in norm: header_map.setdefault('deal', col_idx)
                elif 'price' in norm: header_map['price'] = col_idx
                elif 'net discount' in norm: header_map['netDiscount'] = col_idx
                elif 'discount %' in norm or 'discount%' in norm or ('discount' in norm and '%' in norm): header_map['discountPercent'] = col_idx
                elif 'location' in norm or 'neighborhood' in norm: header_map['location'] = col_idx
                elif 'valid through' in norm or 'valid' in norm or 'expires' in norm: header_map['validThrough'] = col_idx
                elif 'order/source' in norm or 'source' in norm or 'order source' in norm: header_map['orderSource'] = col_idx
            top_deal = None
            food_items = []
            # Quick View has no notes column, so a verified deal's Verification / Notes come from its Verified Deals row.
            verified_by_name = {}
            for vr in live_verified:
                verified_by_name.setdefault(str(vr[1]).strip().lower(), vr)
            for row in qv_vals[h_idx + 1:]:
                if not row or not any(str(c).strip() for c in row): continue
                def get_f(key):
                    idx = header_map.get(key)
                    return str(row[idx]).strip() if idx is not None and len(row) > idx else ''
                rest_val = get_f('restaurant') or (str(row[0]).strip() if row else '')
                if not rest_val: continue
                deal_row = {'restaurant': rest_val, 'deal': get_f('deal'), 'price': get_f('price'), 'netDiscount': get_f('netDiscount'), 'discountPercent': get_f('discountPercent'), 'location': get_f('location'), 'validThrough': get_f('validThrough'), 'orderSource': get_f('orderSource')}
                full = verified_by_name.get(rest_val.lower(), [])
                notes_of = lambda i: str(full[i]).strip() if len(full) > i else ''
                food_items.append(food_item({**deal_row, 'verification': notes_of(7), 'notes': notes_of(12)}, 'verified'))
                if top_deal is None: top_deal = deal_row
                if len(food_items) >= 20: break

            c_idx, c_headers = find_header_row_and_map(cand_vals, ['review', 'status'])
            review_col = None
            for idx,h in enumerate(c_headers):
                if 'review status' in str(h).lower(): review_col = idx; break
            statuses = []
            for row in cand_vals[c_idx + 1:]:
                if not row or not any(str(c).strip() for c in row): continue
                statuses.append(str(row[review_col]).strip().upper() if review_col is not None and len(row) > review_col else '')
            verified = sum(s == 'VERIFIED' for s in statuses)
            rejected = sum(s == 'REJECTED' for s in statuses)
            missing = sum(not s for s in statuses)
            backlog = sum(s not in {'VERIFIED','REJECTED'} for s in statuses)
            # Every live recurring promo goes to the page, which sorts and filters them. The sheet keeps the newest at
            # the bottom, so the list is reversed to put the newest first; write_site_snapshot trims the tail if it is too big.
            recurring_items = []
            for r in reversed(live_recurring):
                cell = lambda i: str(r[i]).strip() if len(r) > i else ''
                recurring_items.append(food_item({'restaurant': cell(1), 'deal': cell(2), 'price': cell(3), 'discount': cell(4), 'location': cell(5), 'validThrough': cell(6), 'orderSource': cell(8),
                                                  'verification': cell(7), 'notes': cell(12)}, 'recurring'))
            return {'count': total_count, 'status': 'available', 'topItem': top_deal, 'items': food_items + recurring_items, 'gear': gear_watch(gear_vals),
                    'stats': {'candidateBacklog': backlog, 'verified': verified, 'rejected': rejected, 'missingReview': missing,
                              'liveVerified': len(live_verified), 'liveRecurring': len(live_recurring), 'expiredHistory': history_count}}
        except Exception as e:
            if '429' in str(e) and attempt < 5:
                time.sleep(min(15, 2 ** (attempt + 1))); continue
            raise


from event_groups import event_group
from food_groups import deal_schedule, food_services, food_type

EVENTS_PER_GROUP = 10  # the feed carries the soonest N of each group, so small categories are not crowded out by campus talks


def pick_per_group(upcoming):
    """Soonest EVENTS_PER_GROUP events of each group, merged back into start order."""
    taken, out = {}, []
    for ts, e in sorted(upcoming, key=lambda t: t[0]):
        if taken.get(e['group'], 0) < EVENTS_PER_GROUP:
            taken[e['group']] = taken.get(e['group'], 0) + 1
            out.append(e)
    return out


def fetch_events_collab(service):
    for attempt in range(6):
        try:
            resp = service.spreadsheets().values().batchGet(
                spreadsheetId=EVENTS_SPREADSHEET_ID,
                ranges=["'Events'!A1:P", "'Daily Triage'!A1:Z60"]
            ).execute()
            vrs = resp.get('valueRanges', [])
            e_vals = vrs[0].get('values', []) if len(vrs) > 0 else []
            dt_vals = vrs[1].get('values', []) if len(vrs) > 1 else []
            e_idx, e_headers = find_header_row_and_map(e_vals, ['event','start'])
            start_col = next((i for i,h in enumerate(e_headers) if str(h).strip().lower() == 'start'), None)
            now = datetime.now(DENVER); horizon = now.timestamp() + 86400
            ecol = {}
            names = {'event name': 'name', 'start': 'start', 'venue': 'venue', 'address': 'address', 'end': 'end', 'source url': 'source', 'category': 'category', 'contributor': 'contributor', 'admission / price': 'price',
                     'ticket / rsvp status': 'rsvp', 'urgency': 'urgency', 'disposition': 'disposition', 'notes': 'notes'}
            for i, h in enumerate(e_headers):
                key = names.get(str(h).strip().lower())
                if key: ecol.setdefault(key, i)
            total_count = 0; next24 = 0; next7 = 0; upcoming = []; dispositions = {}
            for row in e_vals[e_idx + 1:]:
                if not row or not any(str(c).strip() for c in row): continue
                ecell = lambda k: str(row[ecol[k]]).strip() if k in ecol and len(row) > ecol[k] else ''
                disp = ecell('disposition')
                # Disposition Ignored is what the dashboard's x writes (events_dismiss.py in LeviAgent): the row stays in the ledger but leaves the feed and counts.
                if disp.casefold() == 'ignored': continue
                total_count += 1
                dispositions[disp] = dispositions.get(disp, 0) + 1
                ed, _ = parse_event_start(ecell('start'), now.tzinfo)
                if ed is not None and is_upcoming(ecell('start'), now):
                    if ed.timestamp() <= now.timestamp() + 7 * 86400: next7 += 1
                    upcoming.append((ed.timestamp(), {'eventName': clip(ecell('name'), 90), 'start': ecell('start'), 'venue': clip(ecell('venue'), 60), 'group': event_group(ecell('category'), ecell('name'), ecell('venue'), ecell('contributor')), 'address': clip(ecell('address'), 90), 'end': ecell('end'), 'sourceUrl': clip(ecell('source'), 250), 'category': clip(ecell('category'), 30),
                                                      'price': clip(ecell('price'), 40), 'urgency': clip(ecell('urgency'), 20), 'disposition': disp,
                                                      'rsvp': clip(ecell('rsvp'), 80), 'notes': clip(ecell('notes'), 600)}))
                if start_col is not None and len(row) > start_col:
                    d, has_time = parse_event_start(row[start_col], now.tzinfo)
                    # All-day events have no clock time to place inside the 24-hour window, so they are skipped.
                    if d is not None and has_time and now.timestamp() <= d.timestamp() <= horizon: next24 += 1

            h_idx, headers = find_header_row_and_map(dt_vals, ['event'])
            header_map = {}
            for col_idx, h in enumerate(headers):
                norm = h.lower().replace('_', ' ').replace('\n', ' ').strip()
                if 'triage date' in norm or norm == 'date': header_map['triageDate'] = col_idx
                elif norm == 'rank' or 'rank' in norm: header_map['rank'] = col_idx
                elif 'event name' in norm or norm == 'event': header_map['eventName'] = col_idx
                elif norm == 'start' or 'start time' in norm or 'start' in norm: header_map['start'] = col_idx
                elif 'why it made the cut' in norm or 'why' in norm: header_map['whyItMadeTheCut'] = col_idx
                elif 'ticket/rsvp urgency' in norm or 'urgency' in norm: header_map['ticketRsvpUrgency'] = col_idx
                elif 'calendar action' in norm or 'action' in norm: header_map['calendarAction'] = col_idx
                elif 'approval state' in norm or 'approval' in norm: header_map['approvalState'] = col_idx
            parsed_rows = []
            for row in dt_vals[h_idx + 1:]:
                if not row or not any(str(c).strip() for c in row): continue
                def get_f(key):
                    idx = header_map.get(key)
                    return str(row[idx]).strip() if idx is not None and len(row) > idx else ''
                name = get_f('eventName') or (str(row[0]).strip() if row else '')
                if not name: continue
                parsed_rows.append({'triageDate': get_f('triageDate'), 'rank': get_f('rank'), 'rankNum': parse_rank_num(get_f('rank')), 'eventName': name, 'start': get_f('start'), 'whyItMadeTheCut': get_f('whyItMadeTheCut'), 'ticketRsvpUrgency': get_f('ticketRsvpUrgency'), 'calendarAction': get_f('calendarAction'), 'approvalState': get_f('approvalState')})
            latest_date = max([r['triageDate'] for r in parsed_rows if r['triageDate']], default='')
            target_rows = [r for r in parsed_rows if r['triageDate'] == latest_date] if latest_date else parsed_rows
            # A triage pick whose start has already passed is history, not a recommendation.
            target_rows = [r for r in target_rows if is_upcoming(r['start'], now)]
            target_rows.sort(key=lambda r:r['rankNum'])
            best = target_rows[0] if target_rows else None
            proposals = sum(r['calendarAction'].strip().lower() == 'propose' and r['approvalState'].strip().lower() not in {'approved','added','accepted','declined','rejected'} for r in target_rows)
            top_event = None if not best else {'eventName': best['eventName'], 'start': best['start'], 'whyItMadeTheCut': best['whyItMadeTheCut'], 'ticketRsvpUrgency': best['ticketRsvpUrgency'], 'calendarAction': best['calendarAction'], 'approvalState': best['approvalState']}
            upcoming.sort(key=lambda t: t[0])
            return {'count': total_count, 'status': 'available', 'topItem': top_event, 'items': pick_per_group(upcoming),
                    'stats': {'next24': next24, 'next7': next7, 'upcoming': len(upcoming), 'proposalsPending': proposals,
                              'calendarCandidates': dispositions.get('Calendar Candidate', 0), 'watch': dispositions.get('Watch', 0)}}
        except Exception as e:
            if '429' in str(e) and attempt < 5:
                time.sleep(min(15, 2 ** (attempt + 1))); continue
            raise


JOB_STAGES_FILE = Path(os.environ.get('JOB_STAGES_FILE') or r'C:\Users\YOU\Documents\Codex\LeviAgent\data\leviops_job_stages.json')
TRACKED_STAGES = ('applied', 'interviewing', 'offer', 'passed')

def load_job_stages():
    """The application stages the dashboard keeps on this machine (same file as /api/job-stages). Missing or unreadable means none."""
    try:
        data = json.loads(JOB_STAGES_FILE.read_text(encoding='utf-8'))
        return {k: v['stage'] for k, v in data.items() if isinstance(v, dict) and v.get('stage') in TRACKED_STAGES}
    except Exception:
        return {}

# The LeviAgent job pipeline's last scheduled run ({"ok", "at", "detail"}), written by orchestrate_job_pipeline.py and
# run_tests.py. The card warns when the last run was skipped or no run has finished in over a day.
JOB_PIPELINE_STATUS_FILE = Path(os.environ.get('LOCALAPPDATA', '')) / 'LeviAgent' / 'job_pipeline_status.json'

def load_job_pipeline_status():
    """The last job-pipeline run, or None when the file is missing or unreadable (the card then shows no warning)."""
    try:
        data = json.loads(JOB_PIPELINE_STATUS_FILE.read_text(encoding='utf-8'))
        return {'ok': bool(data.get('ok')), 'at': str(data.get('at') or ''), 'detail': str(data.get('detail') or '')[:200]}
    except Exception:
        return None

def fetch_jobs_collab(service):
    for attempt in range(6):
        try:
            resp = service.spreadsheets().values().get(
                spreadsheetId=SPREADSHEET_ID,
                range="'Science Jobs'!A1:T500",  # the pipeline keeps expired rows for 14 days; 100 rows silently cut the card off
            ).execute()
            app_vals = resp.get('values', [])
            h_idx, headers = find_header_row_and_map(app_vals, ['job', 'title', 'employer'])
            header_map = {}
            for col_idx, h in enumerate(headers):
                norm = h.lower().replace('_', ' ').replace('\n', ' ').strip()
                if 'verified at' in norm: header_map['verifiedAt'] = col_idx
                elif norm == 'lane': header_map['lane'] = col_idx
                elif 'verification state' in norm or norm == 'state': header_map['verificationState'] = col_idx
                elif 'domain relevance' in norm or norm == 'relevance': header_map['domainRelevance'] = col_idx
                elif 'qualification state' in norm or 'qualification' in norm: header_map['qualificationState'] = col_idx
                elif 'application tier' in norm or norm == 'tier': header_map['applicationTier'] = col_idx
                elif 'apply order' in norm or norm == 'order': header_map['applyOrder'] = col_idx
                elif 'job title' in norm or norm in ('title', 'role'): header_map['jobTitle'] = col_idx
                elif 'employer' in norm or 'company' in norm: header_map['employer'] = col_idx
                elif norm == 'location' or 'location' in norm: header_map['location'] = col_idx
                elif 'requisition' in norm or 'req id' in norm: header_map['requisitionId'] = col_idx
                elif 'fit score' in norm or 'score' in norm: header_map['fitScore'] = col_idx
                elif 'salary' in norm: header_map['salary'] = col_idx
                elif 'clearance' in norm: header_map['clearance'] = col_idx
                elif 'deadline' in norm: header_map['deadline'] = col_idx
                elif 'next action' in norm or 'action' in norm: header_map['nextAction'] = col_idx
                elif 'url' in norm or 'link' in norm: header_map['url'] = col_idx

            parsed = []
            verified_live_cnt = 0
            domain_qualified_cnt = 0
            qual_pass_cnt = 0
            qual_stretch_cnt = 0
            out_of_scope_cnt = 0
            provisional_cnt = 0
            expired_cnt = 0
            total_count = 0
            checked_at = ''  # the latest Verified At stamp: when the pipeline last checked any posting

            for row in app_vals[h_idx + 1:]:
                if not row or not any(str(c).strip() for c in row): continue
                def get_f(key):
                    idx = header_map.get(key)
                    return str(row[idx]).strip() if idx is not None and len(row) > idx else ''
                title = get_f('jobTitle')
                if not title:
                    title = get_f('notes').split(';')[0].strip() or get_f('employer') or 'Science Position'
                total_count += 1
                checked_at = max(checked_at, get_f('verifiedAt'))
                state = get_f('verificationState').lower()
                rel = get_f('domainRelevance').upper() or 'PASS'
                qual = get_f('qualificationState').upper() or 'PASS'
                next_act = get_f('nextAction')

                # Check if role is domain qualified and qualification status
                is_out_of_scope = (rel == 'OUT_OF_SCOPE' or 'out of scope' in next_act.lower())
                is_domain_pass = not is_out_of_scope
                is_hard_fail = (qual == 'HARD_FAIL' or 'hard disqualifier' in next_act.lower())
                is_stretch = (qual == 'STRETCH' or 'stretch' in next_act.lower())
                is_qual_pass = (is_domain_pass and not is_hard_fail and not is_stretch)
                is_apply_eligible = (state == 'verified_live' and is_domain_pass and not is_hard_fail)

                if state == 'verified_live':
                    verified_live_cnt += 1
                    if is_domain_pass:
                        domain_qualified_cnt += 1
                        if is_qual_pass:
                            qual_pass_cnt += 1
                        elif is_stretch:
                            qual_stretch_cnt += 1
                    else:
                        out_of_scope_cnt += 1
                elif state == 'expired_or_unreachable':
                    expired_cnt += 1
                else:
                    provisional_cnt += 1

                tier = get_f('applicationTier').strip()
                order = get_f('applyOrder')
                num = parse_rank_num(order)
                if num < 999999.0:
                    status_label = 'Verified Live' if state == 'verified_live' else ('Expired / Unavailable' if state == 'expired_or_unreachable' else 'Provisional')
                    if state != 'verified_live':
                        next_act = 'Archived / Job Unavailable' if state == 'expired_or_unreachable' else 'Verify direct requisition before applying'
                    elif is_out_of_scope:
                        next_act = 'Out of Scope / Audit Only (Non-Technical Role)'
                    elif is_hard_fail:
                        next_act = 'Hard Disqualifier / Seniority or Clearance Mismatch'
                    elif is_stretch:
                        next_act = 'Review & Consider Stretch Application'

                    parsed.append({
                        'orderNum': num,
                        'verificationState': state or 'provisional',
                        'domainRelevance': 'OUT_OF_SCOPE' if is_out_of_scope else 'PASS',
                        'qualificationState': qual,
                        'applicationEligible': is_apply_eligible,
                        'isQualPass': is_qual_pass,
                        'applicationTier': tier or 'Tier 2',
                        'applyOrder': order,
                        'jobTitle': title,
                        'employer': get_f('employer'),
                        'location': get_f('location'),
                        'requisitionId': get_f('requisitionId'),
                        'salary': get_f('salary'),
                        'clearance': get_f('clearance'),
                        'status': status_label,
                        'likelihood': 'High' if is_qual_pass else ('Moderate' if is_stretch else 'Provisional'),
                        'careerValue': 'High' if is_domain_pass else 'Low',
                        'nextAction': next_act,
                        'fitScore': get_f('fitScore'),
                        'deadline': get_f('deadline'),
                        'url': get_f('url'),
                        'lane': get_f('lane'),
                    })

            # Prefer qualification-passed verified_live for topItem, then stretch, then best provisional
            qual_pass_items = [p for p in parsed if p.get('isQualPass') and p.get('applicationEligible')]
            qual_pass_items.sort(key=lambda r: r['orderNum'])
            eligible_items = [p for p in parsed if p.get('applicationEligible')]
            eligible_items.sort(key=lambda r: r['orderNum'])

            best = qual_pass_items[0] if qual_pass_items else (eligible_items[0] if eligible_items else (parsed[0] if parsed else None))
            top = None if not best else {
                'applicationTier': best['applicationTier'],
                'applyOrder': best['applyOrder'],
                'jobTitle': best['jobTitle'],
                'employer': best['employer'],
                'location': best['location'],
                'status': best['status'],
                'likelihood': best['likelihood'],
                'careerValue': best['careerValue'],
                'nextAction': best['nextAction'],
                'requisitionId': best.get('requisitionId', ''),
            }
            # A role the user has applied to, is interviewing for, was offered or passed on stays listed after the 30 open roles even
            # once it is expired or ranks lower, so its stage keeps showing. The key is the page's jobKey(): employer (as clipped
            # below) + requisition or title, lowercased.
            def job_item(p):
                return {'applyOrder': p['applyOrder'], 'jobTitle': clip(p['jobTitle'], 100), 'employer': clip(p['employer'], 60), 'location': clip(p['location'], 60),
                        'applicationTier': p['applicationTier'], 'status': p['status'], 'likelihood': p['likelihood'], 'nextAction': clip(p['nextAction'], 80),
                        'salary': clip(p['salary'], 40), 'requisitionId': p.get('requisitionId', ''), 'fitScore': p['fitScore'], 'deadline': clip(p['deadline'], 30),
                        'url': p['url'] if p['url'].lower().startswith('http') and len(p['url']) <= 300 else '',
                        **({'lane': p['lane']} if p.get('lane') else {})}
            # The pipeline ranks both lanes in one list, and the Clinical & lab roles fill its top, so the Earth & GIS
            # lane gets its own share rather than being cut off after the first 30.
            earth = [p for p in eligible_items if p.get('lane') == 'Earth & GIS']
            listed = [job_item(p) for p in sorted([p for p in eligible_items if p.get('lane') != 'Earth & GIS'][:30] + earth[:15], key=lambda r: r['orderNum'])]
            stages = load_job_stages()
            if stages:
                shown = {f"{i['employer']}|{i['requisitionId'] or i['jobTitle']}".lower() for i in listed}
                for p in sorted(parsed, key=lambda r: r['orderNum']):
                    item = job_item(p)
                    key = f"{item['employer']}|{item['requisitionId'] or item['jobTitle']}".lower()
                    if key in stages and key not in shown:
                        shown.add(key); listed.append({**item, 'tracked': True})
            return {
                'count': total_count,
                'status': 'available' if total_count > 0 else 'unavailable',
                'topItem': top,
                'items': listed,
                'state': {'checkedAt': checked_at, 'pipeline': load_job_pipeline_status()},
                'stats': {
                    'verifiedLive': verified_live_cnt,
                    'domainQualified': domain_qualified_cnt,
                    'qualPass': qual_pass_cnt,
                    'qualStretch': qual_stretch_cnt,
                    'outOfScope': out_of_scope_cnt,
                    'provisional': provisional_cnt,
                    'expired': expired_cnt,
                    'applicationEligible': qual_pass_cnt + qual_stretch_cnt,
                    'applyNow': qual_pass_cnt + qual_stretch_cnt,
                }
            }
        except Exception as e:
            if '429' in str(e) and attempt < 5:
                time.sleep(min(15, 2 ** (attempt + 1)))
                continue
            raise

# Pulse runs a 6:30 AM morning brief and an 11:05 PM recap, so the longest normal gap between
# runs is about 16.5 hours. Older than this means a run was actually missed.
PULSE_STALE_SECONDS = 18 * 3600

def _pulse_cell(state, key):
    raw = state.get(key)
    if raw in (None, ''): return None
    try: return json.loads(raw)
    except Exception: return raw

def _pulse_weather_text(w):
    if not isinstance(w, dict): return w or None
    cur = w.get('current') or {}; today = w.get('today') or {}
    parts = []
    if cur.get('temp_f') is not None: parts.append(f"{cur['temp_f']}°F {cur.get('conditions') or ''}".strip())
    if cur.get('relative_humidity_pct') is not None: parts.append(f"humidity {cur['relative_humidity_pct']}%")
    if cur.get('dew_point_f') is not None: parts.append(f"dew point {cur['dew_point_f']}°F")
    if today.get('high_f') is not None: parts.append(f"high {today['high_f']}°F / low {today.get('low_f')}°F")
    if today.get('precip_chance_pct') is not None: parts.append(f"precip {today['precip_chance_pct']}%")
    return ' · '.join(parts) or None

def _pulse_aq_text(a):
    if not isinstance(a, dict): return a or None
    parts = []
    if a.get('us_aqi') is not None: parts.append(f"US AQI {a['us_aqi']} ({a.get('category') or 'n/a'})")
    if a.get('pm2_5_ug_m3') is not None: parts.append(f"PM2.5 {a['pm2_5_ug_m3']} µg/m³")
    return ' · '.join(parts) or None

PULSE_LOCAL = Path(r'C:\Users\YOU\Documents\Codex\LeviAgent\pulse_local.py')

def fetch_rss_items(hours=48, per_category=10, limit=60):
    """Recent items from the Pulse RSS feeds for the dashboard: Pulse's own exclusion rules, but no category skip, so science, tech and gaming show too."""
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location('pulse_local', PULSE_LOCAL)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        cands = sorted(mod.load_candidates(hours, skip_categories=False), key=lambda c: c['published'], reverse=True)
        taken, out = {}, []
        for c in cands:
            cat = c.get('category') or 'Other'
            if taken.get(cat, 0) >= per_category: continue
            taken[cat] = taken.get(cat, 0) + 1
            out.append({'id': f'rss-{len(out) + 1}', 'title': clip(c['title'], 140), 'url': c['link'], 'category': cat, 'source': c.get('site') or c.get('source') or '',
                        'sourceUrl': c.get('site_url') or '', 'feedName': c.get('feed_name') or '', 'commentsUrl': c.get('comments') or '', 'publishedAt': c['published'], 'summary': clip(c.get('summary') or '', 170)})
            if len(out) >= limit: break
        return out
    except Exception as e:
        print(f'WARN_RSS_ITEMS_FAILED: {e}')
        return []

def fetch_pulse_collab(svc):
    """Build the Pulse card from the 'Pulse State' tab, the store pulse_local.py and the Pulse task publish to."""
    default_state = {
        'generatedAt': datetime.now().astimezone().isoformat(),
        'status': 'not_run',
        'latestRun': None,
        'morningBrief': None,
        'latestItems': [],
        'dailyRecap': None,
        'error': None
    }
    empty = {
        'count': 0,
        'status': 'not_run',
        'topItem': None,
        'stats': {'itemsCount': 0, 'morningDelivered': 0, 'dailyRecapAvailable': 0},
        'state': default_state
    }
    try:
        rows = svc.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range="'Pulse State'!A1:C60"
        ).execute().get('values', [])
        cells = {r[0]: (r[1] if len(r) > 1 else '') for r in rows[1:] if r and r[0]}
        stamps = {r[0]: (r[2] if len(r) > 2 else '') for r in rows[1:] if r and r[0]}
        if not cells.get('snapshot_generated_at'):
            return empty

        recap = _pulse_cell(cells, 'daily_recap')
        if isinstance(recap, dict) and 'sections' not in recap:
            recap = {
                'date': recap.get('date') or '',
                'generatedAt': stamps.get('daily_recap') or '',
                'sections': [{
                    'heading': 'Daily recap',
                    'items': [
                        {'title': i.get('topic') or i.get('title') or '', 'summary': i.get('summary') or '', 'url': i.get('url')}
                        for i in (recap.get('items') or []) if isinstance(i, dict)
                    ],
                }] if recap.get('items') else [],
            }
        err = _pulse_cell(cells, 'error')
        if isinstance(err, str): err = {'occurredAt': stamps.get('error') or '', 'message': err}

        data = {
            'generatedAt': cells['snapshot_generated_at'],
            'snapshotGeneratedAt': cells['snapshot_generated_at'],
            'lastSuccessfulPulseRun': cells.get('last_successful_pulse_run') or None,
            'status': cells.get('status') or 'not_run',
            'latestRun': _pulse_cell(cells, 'latest_run'),
            'morningBrief': _pulse_cell(cells, 'morning_brief'),
            'latestItems': _pulse_cell(cells, 'latest_items') or [],
            'dailyRecap': recap,
            'weather': _pulse_weather_text(_pulse_cell(cells, 'weather')),
            'weatherProvider': cells.get('weather_provider') or None,
            'weatherObservedAt': cells.get('weather_observed_at') or None,
            'airQuality': _pulse_aq_text(_pulse_cell(cells, 'air_quality')),
            'aqProvider': cells.get('aq_provider') or None,
            'aqObservedAt': cells.get('aq_observed_at') or None,
            'error': err or None,
        }
        def _strip_placeholder_urls(value):
            if isinstance(value, dict):
                return {
                    key: _strip_placeholder_urls(item)
                    for key, item in value.items()
                    if not (
                        key == 'url'
                        and isinstance(item, str)
                        and item.lower().startswith(('https://example.com','http://example.com','https://www.example.com','http://www.example.com'))
                    )
                }
            if isinstance(value, list):
                return [_strip_placeholder_urls(item) for item in value]
            return value
        data = _strip_placeholder_urls(data)
        raw_status = str(data.get('status') or 'not_run').lower()
        gen_at = data.get('generatedAt') or ''
        status = raw_status
        if raw_status == 'current' and gen_at:
            try:
                t = datetime.fromisoformat(gen_at.replace('Z', '+00:00'))
                age_seconds = (datetime.now().astimezone() - t).total_seconds()
                if age_seconds > PULSE_STALE_SECONDS:
                    status = 'stale'
            except Exception:
                pass

        items = data.get('latestItems') or []
        mb = data.get('morningBrief') or {}
        dr = data.get('dailyRecap') or {}
        top_item = items[0] if items else None

        return {
            'count': len(items),
            'status': status if status in ('current', 'stale', 'failed', 'not_run') else 'not_run',
            'topItem': top_item,
            'items': fetch_rss_items(),
            'stats': {
                'itemsCount': len(items),
                'morningDelivered': 1 if mb.get('delivered') else 0,
                'dailyRecapAvailable': 1 if bool(dr.get('sections')) else 0
            },
            'state': data
        }
    except Exception as e:
        print(f'WARN_PULSE_READ_FAILED: {e}')
        return {
            'count': 0,
            'status': 'failed',
            'topItem': None,
            'stats': {'itemsCount': 0, 'morningDelivered': 0, 'dailyRecapAvailable': 0},
            'state': {**default_state, 'status': 'failed', 'error': {'occurredAt': datetime.now().astimezone().isoformat(), 'message': str(e)}}
        }

def fetch_collab_data(svc):
    collab = {
        'version':'1','updatedAt':datetime.now().astimezone().isoformat(),
        'food':{'count':0,'status':'unavailable','topItem':None,'stats':{'candidateBacklog':0,'verified':0,'rejected':0,'missingReview':0}},
        'events':{'count':0,'status':'unavailable','topItem':None,'stats':{'next24':0,'proposalsPending':0}},
        'jobs':{'count':0,'status':'unavailable','topItem':None,'stats':{'applyNow':0,'inspect':0,'watch':0}},
        'pulse':{'count':0,'status':'not_run','topItem':None,'stats':{'itemsCount':0,'morningDelivered':0,'dailyRecapAvailable':0},'state':None},
    }
    for key,fn in [('food',lambda s: fetch_food_collab(s)),('events',lambda s: fetch_events_collab(s)),('jobs',lambda s: fetch_jobs_collab(s)),('pulse',lambda s: fetch_pulse_collab(s))]:
        try: collab[key]=fn(svc)
        except Exception as e:
            print(f'WARN_COLLAB_{key.upper()}_FETCH_FAILED: {e}'); collab[key]['status']='stale'
    return collab


def write_site_snapshot(service, recent, snap, source_rows, collab=None):
    header = ['record_type','id_or_key','status','engine','current_step','created_at','started_at','finished_at','value','detail','snapshot_updated_at']
    stamp=snap['updatedAt']; out=[header,['meta','schema_version','','','','','','','2','Levi Ops sanitized live dashboard snapshot v2',stamp]]
    metric_keys=['running','queued','activeLeases','requestsPending','requestsBlank','requestsAttention','retainedTerminalHistory','retainedDone','retainedFailed','historicalDlq','archivedRecords']
    metric_names={'activeLeases':'active_leases','requestsPending':'requests_pending','requestsBlank':'requests_blank','requestsAttention':'requests_attention','retainedTerminalHistory':'retained_terminal_history','retainedDone':'retained_done','retainedFailed':'retained_failed','historicalDlq':'historical_dlq','archivedRecords':'archived_records'}
    for key in metric_keys:
        out.append(['metric',metric_names.get(key,key),'','','','','','','%s'%snap[key],str(snap[key]),stamp])
    out.append(['status','system',snap['systemLabel'],'','','','','','',snap['systemDetail'],stamp])
    fail=(('#'+snap['latestFailureId']+' · ') if snap['latestFailureId'] else '')+snap['latestFailureDetail']
    out.append(['status','latest_failure',('Failed' if snap['latestFailureId'] else 'None'),'','','','','','',fail,stamp])
    for key in ('workerId','workerStatus','workerLabel','workerVersion','workerLastSeen','workerLastSeenLabel','sparkGmailHealth','diskFree','workerNote'):
        out.append(['worker',key,'','','','','','','%s'%snap[key],'',stamp])
    for key in ('fleetHealth','providerStatus','edgeFeedStatus'):
        out.append(['health',key,'','','','','','','%s'%snap[key],'',stamp])
    for family in ('gemini','deepseek','claude'):
        item=snap.get('providerUsage',{}).get(family,{})
        detail={'tokensToday':item.get('tokensToday'),'detail':item.get('detail',''),'resetAt':item.get('resetAt','')}
        out.append(['provider_usage',family,item.get('status','UNKNOWN'),family,'','','','','%s'%item.get('tasksToday',0),json.dumps(detail,ensure_ascii=False),stamp])
    for key in ('queue','requests','events','food'):
        payload={'meta':snap[f'{key}AttentionMeta'],'detail':snap[f'{key}AttentionDetail']}
        out.append(['attention',key,snap[f'{key}AttentionTone'],'','','','','','%s'%snap[f'{key}AttentionTitle'],json.dumps(payload,ensure_ascii=False),stamp])
    if collab:
        for row_key,ckey in [('food_deals','food'),('denver_events','events'),('science_jobs','jobs'),('pulse','pulse')]:
            cdata=collab.get(ckey,{})
            detail={'topItem':cdata.get('topItem'), 'stats':cdata.get('stats') or {}, 'state':cdata.get('state'), 'items':cdata.get('items') or []}
            if ckey=='food': detail['gear']=cdata.get('gear') or []
            # A Sheets cell holds 50,000 characters; trim the tail of the list to fit rather than dropping every item.
            def fit(d):
                while d['items'] and len(json.dumps(d,ensure_ascii=False))>45000:
                    d['items']=d['items'][:max(0,len(d['items'])-max(1,len(d['items'])//10))]
                return d
            fit(detail)
            # The dashboard sorts and filters every live food deal and event, which is more than one cell holds, so the rest
            # of the list continues in '<row_key>_more' rows that the page appends to the first.
            overflow=(cdata.get('items') or [])[len(detail['items']):] if ckey in ('food','events') else []
            out.append(['collab_card',row_key,cdata.get('status','unavailable'),'','','','','','%s'%cdata.get('count',0),json.dumps(detail,ensure_ascii=False),stamp])
            for part in range(1,4):
                if not overflow: break
                more=fit({'items':overflow}); overflow=overflow[len(more['items']):]
                out.append(['collab_card',row_key+'_more'+(str(part) if part>1 else ''),cdata.get('status','unavailable'),'','','','','','%s'%len(more['items']),json.dumps(more,ensure_ascii=False),stamp])
    for r in source_rows:
        s=(r.get('status') or '').lower(); detail='Now' if s=='running' else ('Queued' if s=='queued' else clock(r.get('finished_at') or r.get('started_at') or r.get('created_at')))
        out.append(['task',str(r.get('id','')),ds(s),eng(r.get('engine')),r.get('current_step') or ds(s),r.get('created_at') or '',r.get('started_at') or '',r.get('finished_at') or '','',detail,stamp])
    if len(out)-1 > 200: raise RuntimeError(f'SITE_SNAPSHOT_TOO_LARGE={len(out)-1}')
    for attempt in range(6):
        try:
            service.spreadsheets().values().clear(spreadsheetId=SPREADSHEET_ID,range="'Site Snapshot'!A1:K220",body={}).execute()
            service.spreadsheets().values().update(spreadsheetId=SPREADSHEET_ID,range="'Site Snapshot'!A1",valueInputOption='RAW',body={'values':out}).execute()
            chk=service.spreadsheets().values().get(spreadsheetId=SPREADSHEET_ID,range=f"'Site Snapshot'!A1:K{len(out)}").execute().get('values',[])
            if not chk or chk[0]!=header: raise RuntimeError('SITE_SNAPSHOT_VERIFY_FAILED')
            return len(out)-1
        except Exception as e:
            if '429' in str(e) and attempt < 5:
                time.sleep(min(15,2**(attempt+1))); continue
            raise


def provider_usage_snapshot(rows, now_dt):
    """Provider activity plus only quota/token telemetry LeviAgent can substantiate."""
    import json as _json, os as _os, re as _re
    from pathlib import Path as _Path
    from datetime import datetime as _datetime
    local=_Path(_os.environ.get('LOCALAPPDATA',str(_Path.home()/'AppData'/'Local')))/'LeviAgent'
    now_ts=now_dt.timestamp(); today=now_dt.date()
    try:
        config=_json.loads((local/'config.json').read_text(encoding='utf-8'))
        if not isinstance(config,dict): config={}
    except Exception: config={}
    try:
        cooldowns=_json.loads((local/'provider_cooldowns.json').read_text(encoding='utf-8'))
        if not isinstance(cooldowns,dict): cooldowns={}
    except Exception: cooldowns={}
    cfg_text=_json.dumps(config,ensure_ascii=False).lower()
    providers=config.get('providers') if isinstance(config.get('providers'),dict) else {}
    ds=providers.get('deepseek') if isinstance(providers.get('deepseek'),dict) else {}
    configured={
        'gemini':'gemini-' in cfg_text,
        'deepseek':bool(ds.get('enabled',True)) and ('deepseek-' in cfg_text or bool(_os.environ.get('DEEPSEEK_API_KEY','').strip())),
        'claude':'claude-' in cfg_text,
    }
    usage={name:{'status':'UNCONFIGURED','tasksToday':0,'tokensToday':None,'detail':'Not configured','resetAt':''} for name in ('gemini','deepseek','claude')}
    def family(row):
        model=str(row.get('model') or '').strip().lower(); engine=str(row.get('engine') or '').strip().lower()
        if model.startswith('deepseek-') or engine=='deepseek': return 'deepseek'
        if model.startswith('gemini-'): return 'gemini'
        if model.startswith('claude-'): return 'claude'
        return ''
    deepseek_ids=[]
    for row in rows:
        fam=family(row)
        if not fam: continue
        stamp=str(row.get('started_at') or row.get('finished_at') or row.get('created_at') or '')
        try: row_date=_datetime.fromisoformat(stamp.replace('Z','+00:00')).astimezone().date()
        except Exception: continue
        if row_date!=today or str(row.get('status') or '').lower() not in {'running','done','failed','cancelled','canceled'}: continue
        usage[fam]['tasksToday']+=1
        if fam=='deepseek': deepseek_ids.append(str(row.get('id') or ''))
    total=0; seen=False
    for task_id in deepseek_ids:
        if not _re.fullmatch(r'[A-Za-z0-9_.-]+',task_id): continue
        log=local/'logs'/f'task-{task_id}.log'
        if not log.is_file(): continue
        matches=_re.findall(r'usage=({[^\r\n]*})',log.read_text(encoding='utf-8',errors='replace'))
        if not matches: continue
        try:
            val=int(_json.loads(matches[-1]).get('total_tokens',0) or 0)
            if val>=0: total+=val; seen=True
        except Exception: pass
    usage['deepseek']['tokensToday']=total if seen else None
    route=cooldowns.get('antigravity') if isinstance(cooldowns.get('antigravity'),dict) else None
    keys={'gemini':'antigravity:gemini','deepseek':'deepseek','claude':'antigravity:claude'}
    for fam in ('gemini','deepseek','claude'):
        if not configured[fam]: continue
        entry=cooldowns.get(keys[fam]) if isinstance(cooldowns.get(keys[fam]),dict) else None
        if fam in {'gemini','claude'} and route:
            try:
                if float(route.get('disabled_until',0) or 0)>float((entry or {}).get('disabled_until',0) or 0): entry=route
            except Exception: pass
        try: disabled=float((entry or {}).get('disabled_until',0) or 0)
        except Exception: disabled=0.0
        if disabled>now_ts:
            reset=_datetime.fromtimestamp(disabled).astimezone(); reason=str((entry or {}).get('reason') or '')
            usage[fam].update(status='COOLDOWN',resetAt=reset.isoformat(),detail='Quota cooldown until '+reset.strftime('%b %d, %I:%M %p').replace(' 0',' ')+((' - '+reason[:100]) if reason else ''))
        else:
            usage[fam]['status']='AVAILABLE'
            if fam=='deepseek': usage[fam]['detail']=(f"{usage[fam]['tokensToday']:,} tokens recorded today" if isinstance(usage[fam]['tokensToday'],int) else 'Token total not recorded yet')
            else: usage[fam]['detail']='Task activity recorded; no trustworthy quota percentage is exposed here'
    return usage


def fetch_postgres_tasks():
    dsn = os.environ.get('LEVIAGENT_DB_SHADOW_DSN')
    if not dsn:
        return []
    try:
        import psycopg
        with psycopg.connect(dsn, connect_timeout=2) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT logical_task_key, status, payload, created_at, updated_at FROM tasks ORDER BY created_at DESC LIMIT 200")
                rows = []
                for r in cur.fetchall():
                    payload = r[2] if isinstance(r[2], dict) else {}
                    task_dict = dict(payload)
                    task_dict['id'] = str(r[0] or payload.get('id') or '')
                    st = (r[1] or payload.get('status') or '').lower()
                    task_dict['status'] = 'done' if st in ('completed', 'done') else st
                    if r[3]:
                        task_dict['created_at'] = r[3].isoformat()
                    if r[4] and st in ('completed', 'done', 'failed', 'cancelled', 'canceled'):
                        task_dict['finished_at'] = r[4].isoformat()
                    step = str(task_dict.get('current_step') or '').strip()
                    if task_dict['status'] == 'done' and (not step or 'queued' in step.lower()):
                        task_dict['current_step'] = 'completed'
                    elif task_dict['status'] == 'failed' and (not step or 'queued' in step.lower()):
                        task_dict['current_step'] = task_dict.get('failure_type') or 'failed'
                    rows.append(task_dict)
                return rows
    except Exception:
        return []


# The worker writes its heartbeat every 60s.
PG_HEARTBEAT_STALE_SECONDS = 300

def fetch_postgres_health():
    """Latest worker health_state row as (state, observed_at), or None when Postgres has nothing usable."""
    dsn = os.environ.get('LEVIAGENT_DB_SHADOW_DSN')
    if not dsn:
        return None
    try:
        import psycopg
        with psycopg.connect(dsn, connect_timeout=2) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT state, observed_at FROM health_state WHERE state_key = %s", ('leviagent_health_state_v1',))
                row = cur.fetchone()
    except Exception as e:
        print(f'WARN_PG_HEALTH_FETCH_FAILED: {e}')
        return None
    if not row or not isinstance(row[0], dict) or row[1] is None:
        return None
    return row[0], row[1]

def merge_postgres_health(worker, health):
    """Under DB_AUTHORITY the worker heartbeats into Postgres and no longer touches the Worker/Health sheet tabs,
    so those tabs freeze at the cutover. Prefer the Postgres heartbeat; the sheet values remain the fallback."""
    pg = fetch_postgres_health()
    if not pg:
        return worker, health
    state, observed = pg
    fresh = (datetime.now().astimezone() - observed).total_seconds() <= PG_HEARTBEAT_STALE_SECONDS
    worker = dict(worker)
    worker['worker_id'] = state.get('worker_id') or worker.get('worker_id')
    worker['last_seen'] = observed.astimezone().isoformat(timespec='seconds')
    # A heartbeat that stopped must not read as "Idle & ready".
    worker['status'] = str(state.get('status') or 'unknown').lower() if fresh else 'stale'

    edge = state.get('edge_feed_status') or 'UNKNOWN'
    prov = state.get('provider_capacity_status') or 'UNKNOWN'
    errors = int(state.get('recent_errors') or 0)
    depth = state.get('queue_depth')
    # Mirrors the System Health rules in leviagent_core/tracker.py.
    if not fresh: system = 'UNKNOWN (heartbeat stale)'
    elif errors >= 3: system = 'BROKEN'
    elif str(edge).startswith('STALE'): system = 'DEGRADED (Feed Stale)'
    elif prov == 'CAPACITY_EXHAUSTED': system = 'DEGRADED (Provider Capacity)'
    elif prov == 'FALLBACK_ACTIVE': system = 'DEGRADED (Provider Fallback)'
    elif int(state.get('canary_consecutive_failures') or 0) >= 2: system = 'DEGRADED (Canary Failed)'
    elif errors > 0 or (depth is not None and depth > 20): system = 'DEGRADED'
    else: system = 'HEALTHY'
    spark_status = state.get('last_spark_status') or 'UNKNOWN'
    spark = f"{spark_status} (Last ID: {state['last_spark_msg_id']})" if state.get('last_spark_msg_id') else spark_status
    health = {**health, 'System Health': system, 'Deep Sync Capacity': prov, 'Edge Feed': edge, 'Spark/Gmail Health': spark}
    health.pop('Model Capacity', None)
    return worker, health

def main():
    creds=Credentials.from_service_account_file(str(CREDS),scopes=SCOPES)
    svc=build('sheets','v4',credentials=creds,cache_discovery=False)
    q,a,req,workers,dlq=fetch_all(svc)
    try: health=fetch_health_state(svc)
    except Exception as e: print(f'WARN_HEALTH_FETCH_FAILED: {e}'); health={}
    visible=lambda r:(not str(r.get('idempotency_key','')).startswith(('leviops-snapshot-','leviops-site-snapshot-')) and not str(r.get('id','')).lower().startswith(('canary-','synth-')) and str(r.get('task_type','')).lower()!='synthetic_canary' and str(r.get('classification','')).lower()!='synthetic' and str(r.get('delegation_capability','')).lower()!='synthetic_canary' and str(r.get('prompt','')).strip()!='synthetic_canary_probe')
    pg_tasks=fetch_postgres_tasks()
    seen_ids=set()
    merged_q=[]
    for r in pg_tasks + q:
        tid = str(r.get('id') or '').strip()
        if not tid or tid in seen_ids: continue
        seen_ids.add(tid)
        merged_q.append(r)
    merged_a=[]
    for r in a:
        tid = str(r.get('id') or '').strip()
        if not tid or tid in seen_ids: continue
        seen_ids.add(tid)
        merged_a.append(r)
    qv=[r for r in merged_q if visible(r)]; combined=qv+[r for r in merged_a if visible(r)]; combined.sort(key=when,reverse=True)
    recent=[]
    for r in combined[:15]:
        s=(r.get('status') or '').lower(); recent.append({'id':str(r.get('id','')),'status':ds(s),'step':r.get('current_step') or ds(s),'engine':eng(r.get('engine')),'finished':'Now' if s=='running' else ('Queued' if s=='queued' else clock(r.get('finished_at') or r.get('started_at') or r.get('created_at'))),'tone':tone(s)})
    running=sum(str(r.get('status','')).lower()=='running' for r in qv); queued=sum(str(r.get('status','')).lower()=='queued' for r in qv); leases=sum(str(r.get('status','')).lower()=='running' and bool(r.get('lease_expires_at')) for r in qv)
    is_user_req=lambda r:not str(r.get('request_id','')).upper().startswith(('CANARY-','SYNTH-','REQ-CANARY-')) and str(r.get('action','')).lower()!='synthetic_canary'
    pending=sum(str(r.get('status','')).strip().lower()=='pending' and is_user_req(r) for r in req); blank=sum(not str(r.get('status','')).strip() and is_user_req(r) for r in req)
    failures=[r for r in combined if str(r.get('status','')).lower()=='failed']; failures.sort(key=when,reverse=True); lf=failures[0] if failures else None
    worker=workers[0] if workers else {}; worker,health=merge_postgres_health(worker,health); ws=str(worker.get('status') or 'unknown').lower(); updated=datetime.now().astimezone(); label=updated.strftime('%b %#d, %#I:%M %p') if os.name=='nt' else updated.strftime('%b %-d, %-I:%M %p')
    lid=''; ldetail='No recent failures'; lf_time=0; queue_meta='No recent failure'; queue_title='No queue failure needs attention'; queue_detail='No recent terminal failure is recorded.'; queue_tone='neutral'
    if lf:
        lid=str(lf.get('id','')); fl=str(lf.get('failure_type') or lf.get('current_step') or 'failed'); ldetail=f"{fl} · {clock(lf.get('finished_at') or lf.get('started_at') or lf.get('created_at'))}"; lf_time=when(lf); queue_meta=clock(lf.get('finished_at') or lf.get('started_at') or lf.get('created_at')); queue_title=f"Task #{lid} hit quota" if fl.upper() in {'QUOTA','MODEL_CAPACITY_EXHAUSTED'} else f"Task #{lid} failed"; queue_tone='danger'
        later=[r for r in combined if str(r.get('status','')).lower()=='done' and when(r)>lf_time]
        if later:
            recovered=min(later,key=when); mins=max(1,round((when(recovered)-lf_time)/60)); queue_detail=f"This is the latest failure. The worker recovered and completed Task #{recovered.get('id','')} {mins} minute{'s' if mins!=1 else ''} later."
        else: queue_detail='This is the latest failure. No later successful task is recorded yet.'
    collab=fetch_collab_data(svc)
    provider_usage=provider_usage_snapshot(combined, updated)
    food_stats=collab['food'].get('stats',{}); event_stats=collab['events'].get('stats',{}); job_stats=collab['jobs'].get('stats',{})
    req_attention=pending+blank; req_title='Ingress state needs reconciliation' if req_attention else 'Ingress state reconciled'; req_detail=f'{pending} requests remain pending and {blank} have blank status. Queue depth is {queued}.' if req_attention else 'No pending or blank request rows need reconciliation.'
    proposals=int(event_stats.get('proposalsPending',0)); event_title=f"{proposals} proposal{'s' if proposals!=1 else ''} await your decision" if proposals else 'No event proposals await a decision'; event_detail='They are recommendations only. None are treated as approved or added to Calendar.' if proposals else 'The latest triage has no unapproved Propose actions.'
    missing=int(food_stats.get('missingReview',0)); food_title=f"{missing} deal{'s' if missing!=1 else ''} {'have' if missing!=1 else 'has'} no review status" if missing else 'Food review states reconciled'; food_detail='They are excluded from the verified view until the missing status is reconciled.' if missing else 'All current candidate rows have an explicit review state.'
    terminal=[r for r in qv if str(r.get('status','')).lower() in {'done','failed','cancelled','canceled'}]; retained_done=sum(str(r.get('status','')).lower()=='done' for r in terminal); retained_failed=sum(str(r.get('status','')).lower()=='failed' for r in terminal)
    spark_ex=sum(str(r.get('status','')).lower() in {'done','failed','cancelled','canceled'} and 'waiting' in str(r.get('spark_status','')).lower() for r in qv)
    fleet=health.get('System Health','UNKNOWN'); provider=health.get('Model Capacity',health.get('Deep Sync Capacity',health.get('DeepSeek Provider','UNKNOWN'))); edge=health.get('Edge Feed','UNKNOWN'); spark_health=health.get('Spark/Gmail Health','UNKNOWN')
    worker_label='Idle & ready' if ws=='idle' else (f'{running} running' if ws=='running' else 'Worker attention')
    worker_note=(f"{spark_ex} older Spark row{'s' if spark_ex!=1 else ''} still indicate waiting while their tasks are terminal. " if spark_ex else 'No terminal Spark waiting-reply exceptions. ')+f'Fleet: {fleet}. Model capacity: {provider}. Live dashboard feed: {edge}.'
    snap={'updatedAt':updated.isoformat(),'updatedLabel':label,'running':running,'queued':queued,'activeLeases':leases,'requestsPending':pending,'requestsBlank':blank,'requestsAttention':req_attention,'latestFailureId':lid,'latestFailureDetail':ldetail,'systemLabel':'System healthy' if ws in {'idle','running'} else 'Worker attention','systemDetail':f'LeviAgent worker is {ws}. {running} running, {queued} queued. Snapshot updated {label}.','workerId':str(worker.get('worker_id') or '—'),'workerStatus':ws,'workerLabel':worker_label,'workerVersion':str(worker.get('version') or '—'),'workerLastSeen':str(worker.get('last_seen') or ''),'workerLastSeenLabel':clock(worker.get('last_seen')),'sparkGmailHealth':spark_health,'diskFree':str(worker.get('disk_free') or '—'),'workerNote':worker_note,'fleetHealth':fleet,'providerStatus':provider,'providerUsage':provider_usage,'edgeFeedStatus':edge,'retainedTerminalHistory':len(terminal),'retainedDone':retained_done,'retainedFailed':retained_failed,'historicalDlq':len(dlq),'archivedRecords':len(a),'queueAttentionMeta':queue_meta,'queueAttentionTitle':queue_title,'queueAttentionDetail':queue_detail,'queueAttentionTone':queue_tone,'requestsAttentionMeta':f'{req_attention} rows','requestsAttentionTitle':req_title,'requestsAttentionDetail':req_detail,'requestsAttentionTone':'warning' if req_attention else 'neutral','eventsAttentionMeta':'Latest triage','eventsAttentionTitle':event_title,'eventsAttentionDetail':event_detail,'eventsAttentionTone':'warning' if proposals else 'neutral','foodAttentionMeta':f'{missing} rows','foodAttentionTitle':food_title,'foodAttentionDetail':food_detail,'foodAttentionTone':'warning' if missing else 'neutral'}
    ts="export type QueueTone = 'success' | 'danger' | 'warning' | 'neutral';\nexport type QueueRow = { id: string; status: string; step: string; engine: string; finished: string; tone: QueueTone };\n\n"
    ts += """export interface FoodTopDeal { restaurant: string; deal: string; price: string; netDiscount: string; discountPercent: string; location: string; validThrough: string; orderSource: string; }
export interface EventTopItem { eventName: string; start: string; whyItMadeTheCut: string; ticketRsvpUrgency: string; calendarAction: string; approvalState: string; }
export interface JobTopItem { applicationTier: string; applyOrder: string; jobTitle: string; employer: string; location: string; status: string; likelihood: string; careerValue: string; nextAction: string; requisitionId?: string; }
export interface JobItem {
  orderNum?: number;
  verificationState?: string;
  domainRelevance?: string;
  qualificationState?: string;
  applicationEligible?: boolean;
  isQualPass?: boolean;
  isTerminal?: boolean;
  applicationTier: string;
  applyOrder: string;
  jobTitle: string;
  employer: string;
  location: string;
  requisitionId?: string;
  salary?: string;
  clearance?: string;
  status: string;
  likelihood?: string;
  careerValue?: string;
  nextAction: string;
  url?: string;
}
export interface JobSnapshotState {
  items: JobItem[];
}

export interface PulseRun {
  startedAt: string;
  completedAt?: string | null;
  mode: 'morning' | 'recap'; // pulse_local.py --mode
  success: boolean;
}

export interface PulseProgression {
  exercise: string;
  action: 'increase' | 'hold' | 'reps';
  lastLoad: number;
  lastReps: number;
  unit: string;
  nextLoad: number;
  step: number;
  targetReps: number;
}

export interface PulseHealth {
  weight?: {
    series: Array<{ d: string; lb: number }>;
    latestLb: number;
    latestDate: string;
    bodyFatPct?: number;
    lbPerWeek?: number;
    trendDays?: number;
    bodyFat?: { series: Array<{ d: string; pct: number }>; latest: number; latestDate: string; perWeek?: number; trendDays?: number } | null;
    muscle?: { series: Array<{ d: string; lb: number }>; latest: number; latestDate: string; perWeek?: number; trendDays?: number } | null;
  } | null;
  nextWorkout?: string | null;
  lastLiftDate?: string | null;
  lastRunDate?: string | null;
  progression?: PulseProgression[];
  steps?: string | null;
  plan?: PulsePlan | null;
  heartRate?: PulseHeartRate | null;
}

// Today's session from the weekly plan (Mon A, Tue easy run, Wed rest, Thu B, Fri easy run, Sat rest, Sun long run).
export interface PulsePlan {
  kind: 'lift' | 'recover' | 'easy' | 'long' | 'rest' | 'done';
  title: string;
  detail: string;
  at?: string;
  session?: string;
  minutes?: number;
  zone?: number;
  hrLow?: number;
  hrHigh?: number;
  action?: 'start' | 'increase' | 'hold' | 'cut';
  // An afternoon lift on a run day: the morning run is the session, and this is the lift after it.
  lift?: { session: string; title: string; at: string };
  week?: Array<{ date: string; dow: string; plan: string }>;
}

// Average heart rate of each lift or run (the watch records none outside workouts), with zones from the highest reading.
export interface PulseHeartRate {
  series: Array<{ d: string; bpm: number; label: string; max: number }>;
  latest: number;
  latestDate: string;
  perWeek?: number;
  trendDays?: number;
  vo2max?: number;
  vo2maxDate?: string;
  maxHr?: number;
  zones?: Array<{ zone: number; low: number; high: number }>;
}

export interface PulseMorningBrief {
  date: string;
  delivered: boolean;
  deliveredAt?: string | null;
  sections?: {
    healthTraining?: string | null;
    weatherPm25?: string | null;
    bestAction?: string | null;
  };
  health?: PulseHealth | null;
  // A written rundown of the RSS feeds: model-written paragraphs, each with the feed items (title/link from the feed) it covers.
  rss?: Array<{ text: string; links: Array<{ title: string; url: string; source?: string }> }>;
}

export interface PulseItem {
  id: string;
  title: string;
  summary: string;
  category?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  surfacedAt: string;
}

export interface PulseDailyRecapSection {
  heading: string;
  items: Array<{
    title: string;
    summary: string;
    url?: string | null;
  }>;
}

export interface PulseDailyRecap {
  date: string;
  generatedAt: string;
  sections: PulseDailyRecapSection[];
}

export interface PulseError {
  occurredAt: string;
  message: string;
}

export interface PulseSnapshot {
  snapshotGeneratedAt?: string;
  generatedAt: string;
  lastSuccessfulPulseRun?: string | null;
  status: 'current' | 'stale' | 'failed' | 'not_run' | 'offline';
  latestRun?: PulseRun | null;
  morningBrief?: PulseMorningBrief | null;
  latestItems: PulseItem[];
  dailyRecap?: PulseDailyRecap | null;
  weather?: string | null;
  weatherProvider?: string | null;
  weatherObservedAt?: string | null;
  airQuality?: string | null;
  aqProvider?: string | null;
  aqObservedAt?: string | null;
  error?: PulseError | null;
}

export interface CollabCardState<T, S = unknown> {
  count: number;
  status: 'live' | 'stale' | 'available' | 'unavailable' | 'current' | 'failed' | 'not_run' | 'offline';
  topItem: T | null;
  items?: unknown[];
  stats: Record<string, number>;
  state?: S;
}

export interface GearItem {
  product: string;
  seller: string;
  price: string;
  stock: string;
  alert: boolean;
  url: string;
  checkedAt: string;
  notes: string;
}

export interface CollabCardsData {
  version: '1' | '2';
  updatedAt: string;
  food: CollabCardState<FoodTopDeal> & { gear?: GearItem[] };
  events: CollabCardState<EventTopItem>;
  jobs: CollabCardState<JobTopItem>;
  pulse: CollabCardState<PulseItem, PulseSnapshot>;
}

export interface ProviderUsageState { status:string; tasksToday:number; tokensToday:number|null; detail:string; resetAt:string; }
export interface SnapshotState { updatedAt:string; updatedLabel:string; running:number; queued:number; activeLeases:number; requestsPending:number; requestsBlank:number; requestsAttention:number; latestFailureId:string; latestFailureDetail:string; systemLabel:string; systemDetail:string; workerId:string; workerStatus:string; workerLabel:string; workerVersion:string; workerLastSeen:string; workerLastSeenLabel:string; sparkGmailHealth:string; diskFree:string; workerNote:string; fleetHealth:string; providerStatus:string; providerUsage:Record<'gemini'|'deepseek'|'claude',ProviderUsageState>; edgeFeedStatus:string; retainedTerminalHistory:number; retainedDone:number; retainedFailed:number; historicalDlq:number; archivedRecords:number; queueAttentionMeta:string; queueAttentionTitle:string; queueAttentionDetail:string; queueAttentionTone:string; requestsAttentionMeta:string; requestsAttentionTitle:string; requestsAttentionDetail:string; requestsAttentionTone:string; eventsAttentionMeta:string; eventsAttentionTitle:string; eventsAttentionDetail:string; eventsAttentionTone:string; foodAttentionMeta:string; foodAttentionTitle:string; foodAttentionDetail:string; foodAttentionTone:string; }
\n"""
    ts+='export const queueRows: QueueRow[] = '+json.dumps(recent,indent=2)+';\n'; ts+='export const snapshot: SnapshotState = '+json.dumps(snap,indent=2)+';\n'; ts+='export const collabCards: CollabCardsData = '+json.dumps(collab,indent=2)+';\n'; OUT.write_text(ts,encoding='utf-8')
    print('WROTE='+str(OUT)); print(json.dumps(snap,indent=2)); print(json.dumps(collab,indent=2))
    if not is_live_folder():
        print(f'SITE_SNAPSHOT_SKIPPED_NOT_LIVE_FOLDER site={SITE}')
        print(f'LIVE_FEED_PUSH_SKIPPED_NOT_LIVE_FOLDER site={SITE} live={LIVE_SITE}')
        return
    try:
        with snapshot_lock():
            n=write_site_snapshot(svc,recent,snap,combined[:15],collab=collab); print('SITE_SNAPSHOT_ROWS='+str(n))
            push_live_feed()
    except SnapshotLocked as exc:
        # The local app/queueSnapshot.ts is already written; the next refresh (at most 15 minutes away) publishes.
        print(f'SITE_SNAPSHOT_SKIPPED_LOCKED {exc}'); print('LIVE_FEED_PUSH_SKIPPED_LOCKED')
        raise SystemExit(2)

def push_live_feed():
    # LEVIOPS_LIVE_FEED_PUSH_V2
    try:
        import subprocess as _subprocess, sys as _sys
        from pathlib import Path as _Path
        _push=_Path(__file__).with_name('push_live_snapshot.py'); _r=_subprocess.run([_sys.executable,str(_push)],text=True,capture_output=True,timeout=60)
        if _r.stdout.strip(): print(_r.stdout.strip())
        if _r.returncode!=0: print('LIVE_FEED_PUSH_FAILED='+(_r.stderr.strip() or f'exit {_r.returncode}'))
    except Exception as _exc: print('LIVE_FEED_PUSH_FAILED='+repr(_exc))

if __name__ == '__main__':
    main()
