import json,re
from pathlib import Path
site=Path(r"C:\Users\YOU\Documents\Codex\2026-08-26\sites-plugin-sites-openai-bundled-create\work\agent-operations-center")
p=site/'app'/'page.tsx'
t=p.read_text(encoding='utf-8')
if "./queueSnapshot" not in t:
    t=t.replace("import type { ReactNode } from 'react';", "import type { ReactNode } from 'react';\nimport { queueRows, snapshot } from './queueSnapshot';")
t=re.sub(r"\nconst queueRows = \[.*?\n\];\n", "\n", t, count=1, flags=re.S)
t=re.sub(r'<div className="flex items-center gap-2 text-xs font-bold"><span className="h-2 w-2 rounded-full bg-\[#2f9a65\]" /> System healthy</div>\s*<p className="mt-2 text-sm leading-6 text-white/52">.*?</p>', '<div className="flex items-center gap-2 text-xs font-bold"><span className="h-2 w-2 rounded-full bg-[#2f9a65]" /> {snapshot.systemLabel}</div>\n                <p className="mt-2 text-sm leading-6 text-white/52">{snapshot.systemDetail}</p>', t, count=1, flags=re.S)
t=re.sub(r'<MetricCard label="Executing now"[^\n]*', '<MetricCard label="Executing now" value={String(snapshot.running)} detail={`${snapshot.queued} queued · ${snapshot.activeLeases} active leases`} tone="dark" />', t, count=1)
t=re.sub(r'<MetricCard label="Ingress reconciliation"[^\n]*', '<MetricCard label="Ingress reconciliation" value={String(snapshot.requestsAttention)} detail={`${snapshot.requestsPending} pending · ${snapshot.requestsBlank} blank`} tone="gold" />', t, count=1)
t=re.sub(r'<MetricCard label="Latest failure"[^\n]*', '<MetricCard label="Latest failure" value={snapshot.latestFailureId ? `#${snapshot.latestFailureId}` : "None"} detail={snapshot.latestFailureDetail} />', t, count=1)
t=t.replace("<StatusPill tone={task.tone === 'success' ? 'success' : 'danger'}>{task.status}</StatusPill>", "<StatusPill tone={task.tone}>{task.status}</StatusPill>")
p.write_text(t,encoding='utf-8')
pkg=site/'package.json'; j=json.loads(pkg.read_text(encoding='utf-8')); j.setdefault('scripts',{})['refresh:snapshot']='python scripts/refresh_snapshot.py'; pkg.write_text(json.dumps(j,indent=2)+"\n",encoding='utf-8')