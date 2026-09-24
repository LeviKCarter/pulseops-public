'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

// The Science jobs lane's filters: where the role is, a salary floor, and what kind of role it is. "Earth & GIS" is
// the job pipeline's own second lane (GIS, remote sensing and Earth data science, searched and scored separately
// from the clinical/lab roles), so a role's lane from the sheet decides it; the finer clinical / lab / public
// health split is read from the title here, as is the lane for rows written before the sheet had one.

export interface FilterableRole { jobTitle: string; employer: string; location: string; salary?: string; lane?: string; likelihood?: string }

export const JOB_CATEGORIES = ['Earth & GIS', 'Clinical research', 'Lab science', 'Public & environmental health', 'Other research'] as const;
export type JobCategory = (typeof JOB_CATEGORIES)[number];

const EARTH_TITLE = /\bgis\b|geospatial|remote sensing|earth|climate|atmospher|geolog|geophys|hydrolog|lidar|satellite|imagery|spatial|cartograph|glaci|ocean/i;
const EARTH_EMPLOYER = /\bncar\b|\bucar\b|cires|earth lab|usgs|geological survey|\bnoaa\b|maxar|\bnasa\b/i;

export function jobCategory(role: FilterableRole): JobCategory {
  const title = role.jobTitle || '';
  if (role.lane ? role.lane === 'Earth & GIS' : EARTH_TITLE.test(title) || EARTH_EMPLOYER.test(role.employer || '')) return 'Earth & GIS';
  if (/clinical|trial|regulatory|patient|coordinator/i.test(title)) return 'Clinical research';
  if (/\blab\b|laborator|technologist|technician|microbiolog|specimen|histolog|biorepositor/i.test(title)) return 'Lab science';
  if (/environment|public health|communicable|epidemiolog|toxicolog|air quality|water quality/i.test(title)) return 'Public & environmental health';
  return 'Other research';
}

// The top of the posted range as a yearly figure (hourly rates at 2080 hours), or null when no pay is posted.
// The top, not the bottom: a role that can pay the floor is worth seeing.
export function annualTop(salary: string | undefined): number | null {
  const nums = [...(salary || '').matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, ''))).filter(Number.isFinite);
  if (nums.length === 0) return null;
  const top = Math.max(...nums);
  return top < 1000 ? Math.round(top * 2080) : top;
}

export const placeOf = (location: string) => (location || '').split(',')[0].trim() || 'Unlisted';

const SALARY_FLOORS = [50000, 60000, 75000, 100000];

// entryOnly keeps the roles the pipeline's qualification check passed (likelihood "High": stated experience of 3
// years or less, or an entry-level title), dropping the stretch roles.
interface JobView { location: string; minSalary: number | null; category: string; entryOnly: boolean }
const DEFAULT_VIEW: JobView = { location: '', minSalary: null, category: '', entryOnly: false };
const VIEW_KEY = 'leviops-job-filters-v1';
const listeners = new Set<() => void>();
let viewRaw: string | null = null;

const readRaw = (): string => {
  if (viewRaw !== null) return viewRaw;
  try { return localStorage.getItem(VIEW_KEY) ?? ''; } catch { return ''; }
};

function parseView(raw: string): JobView {
  try {
    const saved = JSON.parse(raw || 'null');
    if (!saved || typeof saved !== 'object') return DEFAULT_VIEW;
    return {
      location: typeof saved.location === 'string' ? saved.location : '',
      minSalary: SALARY_FLOORS.includes(saved.minSalary) ? saved.minSalary : null,
      category: JOB_CATEGORIES.some((c) => c === saved.category) ? saved.category : '',
      entryOnly: saved.entryOnly === true,
    };
  } catch { return DEFAULT_VIEW; }
}

// Shared by the card and the full-screen panel, and kept per viewer in localStorage (guarded; memory is the fallback).
export function useJobFilters(): [JobView, (patch: Partial<JobView>) => void] {
  const raw = useSyncExternalStore(
    (notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; },
    readRaw,
    () => '',
  );
  const view = useMemo(() => parseView(raw), [raw]);
  const patch = useCallback((p: Partial<JobView>) => {
    viewRaw = JSON.stringify({ ...parseView(readRaw()), ...p });
    try { localStorage.setItem(VIEW_KEY, viewRaw); } catch { /* kept in memory only */ }
    listeners.forEach((notify) => notify());
  }, []);
  return [view, patch];
}

const passLocation = (view: JobView) => (r: FilterableRole) => !view.location || placeOf(r.location) === view.location;
const passSalary = (view: JobView) => (r: FilterableRole) => { if (view.minSalary === null) return true; const top = annualTop(r.salary); return top !== null && top >= view.minSalary; };
const passCategory = (view: JobView) => (r: FilterableRole) => !view.category || jobCategory(r) === view.category;
export const isEntryRole = (r: FilterableRole) => r.likelihood === 'High';
const passEntry = (view: JobView) => (r: FilterableRole) => !view.entryOnly || isEntryRole(r);

export function filterRoles<T extends FilterableRole>(roles: T[], view: JobView): T[] {
  return roles.filter((r) => passLocation(view)(r) && passSalary(view)(r) && passCategory(view)(r) && passEntry(view)(r));
}

const selectClass = 'min-w-0 max-w-full rounded-md border border-white/[0.14] bg-[#0f1713] px-2 py-0.5 text-[0.75rem] font-bold text-white/85';
const labelClass = 'flex min-w-0 max-w-full items-center gap-1.5 text-[0.75rem] font-bold text-white/62';

function checkedLabel(iso: string | undefined): string {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' });
}

// The count line and dropdowns above the role list. Each dropdown's counts apply the other filters (faceted), so an
// option's number is what picking it would show.
export function JobFilterBar({ roles, view, onChange, checkedAt }: { roles: FilterableRole[]; view: JobView; onChange: (patch: Partial<JobView>) => void; checkedAt?: string }) {
  const shown = filterRoles(roles, view).length;
  const filtered = Boolean(view.location || view.minSalary !== null || view.category || view.entryOnly);
  const forLocations = roles.filter((r) => passSalary(view)(r) && passCategory(view)(r) && passEntry(view)(r));
  const forSalary = roles.filter((r) => passLocation(view)(r) && passCategory(view)(r) && passEntry(view)(r));
  const forCategories = roles.filter((r) => passLocation(view)(r) && passSalary(view)(r) && passEntry(view)(r));
  const forLevel = roles.filter((r) => passLocation(view)(r) && passSalary(view)(r) && passCategory(view)(r));
  const places = [...new Set(roles.map((r) => placeOf(r.location)))]
    .map((p) => [p, forLocations.filter((r) => placeOf(r.location) === p).length] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cats = JOB_CATEGORIES.filter((c) => c === view.category || roles.some((r) => jobCategory(r) === c))
    .map((c) => [c, forCategories.filter((r) => jobCategory(r) === c).length] as const);
  const checked = checkedLabel(checkedAt);
  if (roles.length === 0) return checked ? <p className="text-[0.75rem] font-bold text-white/62">Checked {checked}</p> : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label="Filter science jobs">
      <p className="mr-auto text-[0.75rem] font-bold text-white/62" aria-live="polite">
        {filtered ? `${shown} of ${roles.length} roles` : `${roles.length} roles`}{checked ? ` · checked ${checked}` : ''}
      </p>
      <label className={labelClass} title="Entry level: roles the pipeline found you qualify for now (3 years' experience or less, or an entry-level title)">
        Level
        <select value={view.entryOnly ? 'entry' : ''} onChange={(e) => onChange({ entryOnly: e.target.value === 'entry' })} className={selectClass}>
          <option value="">All</option>
          <option value="entry">Entry level ({forLevel.filter(isEntryRole).length})</option>
        </select>
      </label>
      <label className={labelClass}>
        Type
        <select value={view.category} onChange={(e) => onChange({ category: e.target.value })} className={selectClass}>
          <option value="">All</option>
          {cats.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
        </select>
      </label>
      <label className={labelClass}>
        Where
        <select value={view.location} onChange={(e) => onChange({ location: e.target.value })} className={selectClass}>
          <option value="">All</option>
          {places.map(([p, n]) => <option key={p} value={p}>{p} ({n})</option>)}
        </select>
      </label>
      <label className={labelClass} title="Roles whose posted range reaches this much a year (hourly pay counted at 2080 hours)">
        Pay
        <select value={view.minSalary ?? ''} onChange={(e) => onChange({ minSalary: e.target.value ? Number(e.target.value) : null })} className={selectClass}>
          <option value="">Any</option>
          {SALARY_FLOORS.map((f) => <option key={f} value={f}>${f / 1000}k+ ({forSalary.filter((r) => (annualTop(r.salary) ?? -1) >= f).length})</option>)}
        </select>
      </label>
    </div>
  );
}

export function describeJobFilters(view: JobView): string {
  return [view.entryOnly ? 'Entry level' : '', view.category, view.location, view.minSalary !== null ? `$${view.minSalary / 1000}k+` : ''].filter(Boolean).join(' + ');
}

export const CLEAR_JOB_FILTERS: Partial<JobView> = { location: '', minSalary: null, category: '', entryOnly: false };
