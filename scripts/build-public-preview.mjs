#!/usr/bin/env node
// Builds a sanitized, static GitHub Pages preview of the LeviOps dashboard.
//
// This NEVER touches the canonical app in place. It copies the repo into a throwaway staging
// directory, swaps in sanitized fixture data and an export-mode Next config, deletes the
// server-only API routes (which cannot run on GitHub Pages anyway), and runs `vinext build`
// there. The result is copied back to public-preview-dist/ at the repo root for local
// inspection. Nothing here pushes, publishes, or deploys anything.
//
// Usage: node scripts/build-public-preview.mjs
// Optional: GH_PAGES_BASE_PATH=/repo-name node scripts/build-public-preview.mjs
//   (set this when deploying to https://<user>.github.io/<repo-name>/ rather than a root domain)

import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const STAGE = join(ROOT, '.public-preview-stage');
const OUT = join(ROOT, 'public-preview-dist');

const EXCLUDE = new Set([
  'node_modules', '.git', 'dist', '.next', '.vinext', '.wrangler',
  'handoff', 'public-preview-dist', '.public-preview-stage',
  'tsconfig.tsbuildinfo', 'coverage',
]);

function log(msg) {
  console.log(`[public-preview] ${msg}`);
}

function shouldSkip(name) {
  if (EXCLUDE.has(name)) return true;
  if (name.startsWith('scratch-handoff-')) return true;
  return false;
}

// The stage's node_modules is a junction to the real node_modules (which in a worktree is itself a
// junction to the live folder's). Unlink the link itself before deleting the stage, so no recursive
// delete can walk through it and remove_worktree.ps1 isn't blocked by a leftover junction.
function removeStage() {
  const stageModules = join(STAGE, 'node_modules');
  let st = null;
  try { st = lstatSync(stageModules); } catch { /* not there */ }
  if (st?.isSymbolicLink()) unlinkSync(stageModules);
  else if (st) throw new Error(`${stageModules} is not a link; refusing to delete it recursively. Remove it by hand.`);
  rmSync(STAGE, { recursive: true, force: true });
}

async function main() {
  log(`Staging a sanitized copy at ${STAGE}`);
  removeStage();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });

  const fs = await import('node:fs/promises');
  for (const entry of await fs.readdir(ROOT, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    cpSync(join(ROOT, entry.name), join(STAGE, entry.name), { recursive: true });
  }

  log('Removing server-only API routes (not usable on static hosting; also gate local-only actions)');
  rmSync(join(STAGE, 'app', 'api'), { recursive: true, force: true });

  log('Swapping in sanitized fixture data (app/queueSnapshot.ts)');
  cpSync(
    join(ROOT, 'public-preview', 'fixtures', 'queueSnapshot.ts'),
    join(STAGE, 'app', 'queueSnapshot.ts'),
  );

  log('Disabling the live automation feed fetch (public preview shows static sample data only)');
  const liveFeedUrlPath = join(STAGE, 'app', 'liveFeedUrl.ts');
  writeFileSync(
    liveFeedUrlPath,
    `// Public preview build: the live automation feed is intentionally disconnected. This path\n` +
    `// never resolves, so the dashboard falls back to (and stays on) the static sample data\n` +
    `// bundled at build time. See scripts/build-public-preview.mjs.\nexport function isLocalHost(): boolean { return false; }\nexport function liveFeedUrl(): string { return ''; }\n`,
    'utf8',
  );

  log('Removing private Google Sheet links from the page header');
  const pagePath = join(STAGE, 'app', 'page.tsx');
  // Normalize to LF: a Windows checkout with core.autocrlf=true has CRLF, which the `\n` in the
  // patterns below would never match.
  let pageSrc = readFileSync(pagePath, 'utf8').replace(/\r\n/g, '\n');
  const sourceLinksRe = /const sourceLinks = \{[\s\S]*?\n\};\n/;
  if (!sourceLinksRe.test(pageSrc)) {
    throw new Error('Could not find sourceLinks block in app/page.tsx — the file shape changed; update scripts/build-public-preview.mjs.');
  }
  pageSrc = pageSrc.replace(
    sourceLinksRe,
    `// Public preview build: the private Google Sheet links are removed entirely (see\n` +
    `// scripts/build-public-preview.mjs). '#' keeps the shared component tree unchanged.\n` +
    `const sourceLinks = { queue: '#', food: '#', events: '#', jobs: '#' };\n`,
  );

  const liveFeedEffectRe = /(\n  useEffect\(\(\) => \{\n    let active = true;\n    let inFlight = false;\n)/;
  if (!liveFeedEffectRe.test(pageSrc)) {
    throw new Error('Could not find the live-feed polling effect in app/page.tsx — the file shape changed; update scripts/build-public-preview.mjs.');
  }
  pageSrc = pageSrc.replace(
    liveFeedEffectRe,
    `$1    // Public preview build: the live feed is disconnected (see scripts/build-public-preview.mjs),\n` +
    `    // so skip polling a URL that can only ever 404 and just keep the bundled sample data.\n` +
    `    if (!liveFeedUrl()) return;\n`,
  );

  const footerRe = /Levi Ops · owner-only operations snapshot/;
  if (!footerRe.test(pageSrc)) {
    throw new Error('Could not find the footer text in app/page.tsx — the file shape changed; update scripts/build-public-preview.mjs.');
  }
  pageSrc = pageSrc.replace(footerRe, 'Levi Ops · public preview · sample data, not live');
  writeFileSync(pagePath, pageSrc, 'utf8');

  log('Installing the export-mode Next config (output: "export")');
  cpSync(join(ROOT, 'public-preview', 'next.config.export.ts'), join(STAGE, 'next.config.ts'));

  log('Linking node_modules from the real project (no reinstall needed)');
  const stageModules = join(STAGE, 'node_modules');
  symlinkSync(resolve(ROOT, 'node_modules'), stageModules, 'junction');

  log('Running `vinext build` in the staged copy');
  const bin = process.platform === 'win32' ? 'vinext.cmd' : 'vinext';
  const vinextBin = join(ROOT, 'node_modules', '.bin', bin);
  const useShell = process.platform === 'win32';
  const result = existsSync(vinextBin)
    ? spawnSync(useShell ? `"${vinextBin}" build` : vinextBin, useShell ? [] : ['build'], {
        cwd: STAGE, stdio: 'inherit', env: { ...process.env }, shell: useShell,
      })
    : spawnSync(useShell ? 'npx vinext build' : 'npx', useShell ? [] : ['vinext', 'build'], {
        cwd: STAGE, stdio: 'inherit', env: { ...process.env }, shell: useShell,
      });
  if (result.status !== 0) {
    throw new Error(`vinext build failed with exit code ${result.status}`);
  }

  const candidates = ['out', 'dist/client', 'dist'].map((p) => join(STAGE, p));
  const exportDir = candidates.find((p) => existsSync(p));
  if (!exportDir) {
    throw new Error(`Could not locate the export output in the staged build (looked for: ${candidates.join(', ')})`);
  }

  log(`Copying static output from ${exportDir} to ${OUT}`);
  cpSync(exportDir, OUT, { recursive: true });

  log('Done. Nothing was published, pushed, or deployed.');
  log(`Static preview output: ${OUT}`);
}

try {
  await main();
} catch (err) {
  console.error(`[public-preview] FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  try {
    removeStage();
    log('Removed the staging copy.');
  } catch (err) {
    console.error(`[public-preview] Could not remove ${STAGE}: ${err.message}`);
    process.exitCode = 1;
  }
}
