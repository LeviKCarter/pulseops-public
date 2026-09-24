from __future__ import annotations
import json, os, time, urllib.request
from pathlib import Path
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SPREADSHEET_ID = "YOUR_QUEUE_SPREADSHEET_ID"
RANGE = "'Site Snapshot'!A1:K200"
HEADERS = ["record_type","id_or_key","status","engine","current_step","created_at","started_at","finished_at","value","detail","snapshot_updated_at"]
LOCAL = Path(os.environ["LOCALAPPDATA"]) / "LeviAgent"
CONFIG = LOCAL / "leviops-live-feed.json"
CREDS = LOCAL / "google-service-account.json"

def read_rows():
    creds = Credentials.from_service_account_file(str(CREDS), scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
    last = None
    for attempt in range(4):
        try:
            return svc.spreadsheets().values().get(spreadsheetId=SPREADSHEET_ID, range=RANGE).execute().get("values", [])
        except Exception as exc:
            last = exc
            if "429" not in str(exc) or attempt == 3:
                raise
            time.sleep(1.5 * (2 ** attempt))
    raise last

def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    token = Path(cfg["token_file"]).read_text(encoding="utf-8").strip()
    values = read_rows()
    if not values or values[0] != HEADERS:
        raise RuntimeError(f"Site Snapshot header mismatch: {values[0] if values else 'EMPTY'}")
    rows = []
    for raw in values[1:]:
        padded = list(raw) + [""] * (len(HEADERS) - len(raw))
        rows.append({k: padded[i] for i, k in enumerate(HEADERS)})
    stamp = rows[0]["snapshot_updated_at"] if rows else None
    payload = json.dumps({"schema": "levi-ops-live-v1", "snapshot_updated_at": stamp, "rows": rows}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        cfg["url"],
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "LeviOps-LiveFeed/1.0 (Windows NT 10.0; Win64; x64)",
        }
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    if not body.get("ok") or body.get("rows") != len(rows):
        raise RuntimeError(f"Live feed push rejected: {body}")
    print(f"LIVE_FEED_PUSH_OK rows={len(rows)} snapshot={stamp}")

if __name__ == "__main__":
    main()
