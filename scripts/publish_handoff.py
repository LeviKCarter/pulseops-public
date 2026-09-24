from pathlib import Path
import json, subprocess, hashlib, tarfile, os, sys, shutil
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'handoff'
BUNDLE=OUT/'agent-operations-center-site.tar.gz'
MANIFEST=OUT/'manifest.json'
EXCLUDES={'.git','node_modules','.next','dist','handoff'}
def run(cmd):
    p=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True)
    print('$ '+' '.join(cmd)); print(p.stdout); print(p.stderr,file=sys.stderr)
    if p.returncode: raise SystemExit(p.returncode)
def sha256(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
run([sys.executable,str(ROOT/'scripts'/'refresh_snapshot.py')])
run(['npm.cmd','run','build'])
run(['npm.cmd','run','lint'])
OUT.mkdir(exist_ok=True)
if BUNDLE.exists(): BUNDLE.unlink()
include=[]
for rel in ['app','public','scripts','package.json','package-lock.json','vite.config.ts','tsconfig.json','next.config.ts','.openai']:
    p=ROOT/rel
    if p.exists(): include.append(p)
with tarfile.open(BUNDLE,'w:gz') as tf:
    for p in include:
        tf.add(p,arcname=p.relative_to(ROOT))
manifest={
  'schema':'levi-ops-sites-handoff-v1',
  'site_project_id':'YOUR_HOSTING_PROJECT_ID',
  'site_url':'https://your-site.example.com/',
  'bundle':BUNDLE.name,
  'bundle_sha256':sha256(BUNDLE),
  'snapshot_source':'LeviAgentQueue / Site Snapshot',
  'snapshot_file':'app/queueSnapshot.ts',
  'privacy_contract':'sanitized snapshot only; do not publish Queue prompts/results/commands/credentials',
}
MANIFEST.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('BUNDLE='+str(BUNDLE))
print('MANIFEST='+str(MANIFEST))
print('SHA256='+manifest['bundle_sha256'])
