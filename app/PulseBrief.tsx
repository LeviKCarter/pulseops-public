import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { isLocalHost } from './liveFeedUrl';
import type { PulseHealth, PulseMorningBrief, PulsePlan } from './queueSnapshot';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const unitLabel = (unit: string) => (unit === 'lbs' ? 'lb' : unit);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/* ---------- Conditions at a glance ---------- */

interface ParsedWeather { temp: number; condition: string; humidity: number | null; dew: number | null; high: number | null; low: number | null; precip: number | null }

// The producer flattens Open-Meteo readings into one line; every field is optional, so parse defensively and fall back to the raw text.
export function parseWeather(text: string | null | undefined): ParsedWeather | null {
  const t = /^\s*(-?\d+(?:\.\d+)?)\s*°F\s*([^·]*)/.exec(text || '');
  if (!t) return null;
  const grab = (re: RegExp) => { const m = re.exec(text || ''); return m ? Number(m[1]) : null; };
  const hl = /high\s*(-?\d+(?:\.\d+)?)\s*°F\s*\/\s*low\s*(-?\d+(?:\.\d+)?)\s*°F/i.exec(text || '');
  return {
    temp: Number(t[1]),
    condition: t[2].trim(),
    humidity: grab(/humidity\s*(\d+(?:\.\d+)?)\s*%/i),
    dew: grab(/dew point\s*(-?\d+(?:\.\d+)?)\s*°F/i),
    high: hl ? Number(hl[1]) : null,
    low: hl ? Number(hl[2]) : null,
    precip: grab(/precip\w*\s*(\d+(?:\.\d+)?)\s*%/i),
  };
}

// Shared by every icon lookup below; returns null for "clear/sunny", which needs a day/night call the other patterns don't.
function patternIcon(condition: string): string | null {
  const c = condition.toLowerCase();
  if (/thunder|storm/.test(c)) return '⛈️';
  if (/snow|sleet|flurr/.test(c)) return '❄️';
  if (/rain|drizzle|shower/.test(c)) return RAINY_ICON;
  if (/fog|mist|haze|smoke/.test(c)) return '🌫️';
  if (/partly|mostly clear|few clouds/.test(c)) return '⛅';
  if (/cloud|overcast/.test(c)) return '☁️';
  return null;
}

// For a condition already paired with its own isDaytime flag (Google's hourly/daily forecast gives one per entry).
function conditionIconAt(condition: string, isDaytime: boolean): string {
  return patternIcon(condition) ?? (/clear|sun/.test(condition.toLowerCase()) ? (isDaytime ? '☀️' : '🌙') : '🌡️');
}

// A forecast hour or day only gets the umbrella once rain is this likely; below it, a "light rain" forecast shows a
// cloud (the chance itself still prints under the icon). Also where the day rain summary starts calling rain likely.
const RAIN_ICON_MIN_PCT = 40;
const RAINY_ICON = '☔';
const unlikelyRain = (precip: number | null) => precip !== null && precip < RAIN_ICON_MIN_PCT;
function forecastIconAt(condition: string, isDaytime: boolean, precip: number | null): string {
  const icon = conditionIconAt(condition, isDaytime);
  return icon === RAINY_ICON && unlikelyRain(precip) ? '☁️' : icon;
}

// For the headline current-conditions icon, whose day/night call is derived from the observation clock instead.
function conditionIcon(condition: string, observedAt: string | null | undefined): string {
  const p = patternIcon(condition);
  if (p) return p;
  if (!/clear|sun/.test(condition.toLowerCase())) return '🌡️';
  const hour = Number(new Date(observedAt || '').toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Denver' }));
  return Number.isFinite(hour) && (hour >= 20 || hour < 6) ? '🌙' : '☀️';
}

/* ---------- Hourly forecast ---------- */

// dayTag names the weekday on the first point of a new day, where a row that skips overnight jumps to tomorrow.
interface HourPoint { label: string; temp: number; icon: string; precip: number | null; dayTag?: string }
// One hour of the week, for a day opened in the week forecast. date is the Denver calendar day (YYYY-MM-DD).
export interface DayHour extends HourPoint { date: string; hour: number }
interface DayPoint { date: string; hi: number; lo: number; precip: number | null; precipIn: number | null; icon: string }
interface LiveCurrent { tempF: number; feelsLikeF: number | null; dewPointF: number | null; humidityPct: number | null; condition: string | null; isDaytime: boolean | null; precipPct: number | null; source: 'Google Weather' | 'Open-Meteo' }
interface LiveAirQuality { aqi: number | null; category: string | null; dominantPollutant: string | null; pm25: number | null }
// today is every hour of the Denver calendar day, past and forecast, for the card's day graph.
interface Forecast { hours: HourPoint[]; today: DayHour[]; days: DayPoint[]; current: LiveCurrent | null; airQuality: LiveAirQuality | null }
const EMPTY_FORECAST: Forecast = { hours: [], today: [], days: [], current: null, airQuality: null };
const denverToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });

// One entry per hour of today, earlier sources first so a later one (the forecast) wins a shared hour.
function todayHours(...sources: DayHour[][]): DayHour[] {
  const key = denverToday();
  const byHour = new Map<number, DayHour>();
  for (const h of sources.flat()) if (h.date === key) byHour.set(h.hour, h);
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

// On the local dashboard the server picks the forecast point from the phone's Tasker location (same as Pulse), and
// /api/forecast runs the Google Weather + Air Quality APIs there (the same ones the Pulse producer uses) so the
// headline numbers reflect a live reading rather than the producer's last snapshot, which can be an hour or more
// stale. Anywhere else there is no such server (and no Google credentials), so the page asks Open-Meteo directly
// for central Denver, the point Pulse falls back to — current temperature only, no live humidity/dew/AQI there.
const DENVER_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast?latitude=39.74&longitude=-104.99&current=temperature_2m&hourly=temperature_2m,weather_code,is_day,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&forecast_days=7';
const FORECAST_TTL_MS = 25 * 60 * 1000;
const FORECAST_POINTS = 24; // every waking hour, which reaches into tomorrow
// The card's hourly row (and the phone header's strip) skip overnight: only 7 AM through 10 PM, the same waking span
// the week dropdown's blocks use. The CLI asks Google for 48 hours, so a morning load reaches tomorrow morning too.
const isWaking = (h: DayHour) => h.hour >= SLOT_FIRST_HOUR && h.hour <= SLOT_LAST_HOUR;
// The card's row: every waking hour, with the weekday on the first point after the overnight gap.
function rowHours(hours: DayHour[]): HourPoint[] {
  const pts = hours.filter(isWaking).slice(0, FORECAST_POINTS);
  return pts.map((h, i) => (i > 0 && h.date !== pts[i - 1].date
    ? { ...h, dayTag: new Date(`${h.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) }
    : h));
}
let forecastCache: { at: number; forecast: Forecast } | null = null;

// WMO weather codes, for the Open-Meteo fallback only; the Google path gets its icons from forecastIconAt instead.
function codeIcon(code: number, isDay: boolean, precip: number | null = null): string {
  if (code === 0 || code === 1) return isDay ? '☀️' : '🌙';
  if (code === 2) return isDay ? '⛅' : '☁️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return unlikelyRain(precip) ? '☁️' : RAINY_ICON;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

interface GoogleForecastPayload {
  ok?: boolean; error?: string;
  current?: { tempF?: number | null; feelsLikeF?: number | null; dewPointF?: number | null; humidityPct?: number | null; condition?: string | null; isDaytime?: boolean | null; precipProbabilityPct?: number | null };
  hourly?: Array<{ time?: string | null; tempF?: number | null; condition?: string | null; isDaytime?: boolean | null; precipProbabilityPct?: number | null }>;
  pastHourly?: GoogleForecastPayload['hourly'];
  days?: Array<{ date?: string | null; hiF?: number | null; loF?: number | null; precipProbabilityPct?: number | null; precipIn?: number | null; condition?: string | null }>;
  airQuality?: { aqi?: number | null; category?: string | null; dominantPollutant?: string | null; pm25?: number | null };
}

const hourLabel = (hr: number) => `${hr % 12 || 12} ${hr < 12 ? 'AM' : 'PM'}`;

// Google's hours carry UTC instants; each is placed on its Denver day and hour.
function googleHours(hourly: GoogleForecastPayload['hourly']): DayHour[] {
  return hourly?.flatMap((h) => {
    if (typeof h.tempF !== 'number' || !h.time) return [];
    const at = new Date(h.time);
    const hr = Number(at.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Denver' })) % 24;
    if (!Number.isFinite(hr)) return [];
    const isDaytime = h.isDaytime ?? (hr >= 6 && hr < 20);
    return [{ date: at.toLocaleDateString('en-CA', { timeZone: 'America/Denver' }), hour: hr, label: hourLabel(hr), temp: Math.round(h.tempF), icon: forecastIconAt(h.condition || '', isDaytime, h.precipProbabilityPct ?? null), precip: h.precipProbabilityPct ?? null }];
  }) ?? [];
}

function loadGoogleForecast(data: GoogleForecastPayload): Forecast {
  const hours = googleHours(data.hourly);
  const days: DayPoint[] = data.days?.flatMap((d) => (
    typeof d.hiF === 'number' && typeof d.loF === 'number' && d.date
      ? [{ date: d.date, hi: Math.round(d.hiF), lo: Math.round(d.loF), precip: d.precipProbabilityPct ?? null, precipIn: d.precipIn ?? null, icon: forecastIconAt(d.condition || '', true, d.precipProbabilityPct ?? null) }]
      : []
  )) ?? [];
  const current: LiveCurrent | null = typeof data.current?.tempF === 'number' ? {
    tempF: Math.round(data.current.tempF),
    feelsLikeF: typeof data.current.feelsLikeF === 'number' ? Math.round(data.current.feelsLikeF) : null,
    dewPointF: typeof data.current.dewPointF === 'number' ? Math.round(data.current.dewPointF) : null,
    humidityPct: data.current.humidityPct ?? null,
    condition: data.current.condition ?? null,
    isDaytime: data.current.isDaytime ?? null,
    precipPct: data.current.precipProbabilityPct ?? null,
    source: 'Google Weather',
  } : null;
  const airQuality: LiveAirQuality | null = data.airQuality ? {
    aqi: data.airQuality.aqi ?? null,
    category: data.airQuality.category ?? null,
    dominantPollutant: data.airQuality.dominantPollutant ?? null,
    pm25: data.airQuality.pm25 ?? null,
  } : null;
  const today = todayHours(googleHours(data.pastHourly), hours);
  return { hours: rowHours(hours), today, days, current, airQuality };
}

async function loadOpenMeteoForecast(): Promise<Forecast> {
  const res = await fetch(DENVER_FORECAST_URL);
  if (!res.ok) throw new Error(`forecast HTTP ${res.status}`);
  const data = await res.json() as OpenMeteoPayload;
  openMeteoCache = data;
  return openMeteoForecast(data);
}

type OpenMeteoPayload = { timezone?: string; current?: { temperature_2m?: number }; hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[]; is_day?: number[]; precipitation_probability?: Array<number | null> }; daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: Array<number | null>; precipitation_sum?: Array<number | null> } };
let openMeteoCache: OpenMeteoPayload | null = null;

// Open-Meteo's hourly times are already wall-clock in the forecast point's timezone ("2026-09-21T15:00").
function openMeteoHours(data: OpenMeteoPayload): DayHour[] {
  const { time, temperature_2m: temps, weather_code: codes, is_day: days, precipitation_probability: pops } = data.hourly ?? {};
  if (!time || !temps || !codes) return [];
  return time.flatMap((t, i) => {
    if (!Number.isFinite(temps[i])) return [];
    const hr = Number(t.slice(11, 13));
    return [{ date: t.slice(0, 10), hour: hr, label: hourLabel(hr), temp: Math.round(temps[i]), icon: codeIcon(codes[i], days ? days[i] === 1 : hr >= 6 && hr < 20, pops?.[i] ?? null), precip: pops?.[i] ?? null }];
  });
}

function openMeteoForecast(data: OpenMeteoPayload): Forecast {
  const currentTemp = typeof data.current?.temperature_2m === 'number' && Number.isFinite(data.current.temperature_2m) ? Math.round(data.current.temperature_2m) : null;
  const current: LiveCurrent | null = currentTemp !== null ? { tempF: currentTemp, feelsLikeF: null, dewPointF: null, humidityPct: null, condition: null, isDaytime: null, precipPct: null, source: 'Open-Meteo' } : null;
  const d = data.daily;
  const dayPoints: DayPoint[] = (d?.time ?? []).flatMap((date, i) => {
    const hi = d?.temperature_2m_max?.[i], lo = d?.temperature_2m_min?.[i];
    const precip = d?.precipitation_probability_max?.[i] ?? null;
    return typeof hi === 'number' && typeof lo === 'number' ? [{ date, hi: Math.round(hi), lo: Math.round(lo), precip, precipIn: d?.precipitation_sum?.[i] ?? null, icon: codeIcon(d?.weather_code?.[i] ?? -1, true, precip) }] : [];
  });
  // Compare against the current hour in the forecast point's own timezone.
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone || 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const nowKey = `${p.year}-${p.month}-${p.day}T${p.hour}`;
  const all = openMeteoHours(data);
  const upcoming = all.filter((h) => `${h.date}T${String(h.hour).padStart(2, '0')}` > nowKey);
  return { hours: rowHours(upcoming), today: todayHours(all), days: dayPoints, current, airQuality: null };
}

async function loadForecast(): Promise<Forecast> {
  if (!isLocalHost(window.location.hostname)) return loadOpenMeteoForecast();
  const res = await fetch('/api/forecast', { cache: 'no-store' });
  if (!res.ok) throw new Error(`forecast HTTP ${res.status}`);
  const data = await res.json() as GoogleForecastPayload;
  if (data.ok === false) throw new Error(data.error || 'forecast unavailable');
  return loadGoogleForecast(data);
}

// Every hour of the week, fetched the first time a day in the week forecast is opened and by the Events lane to mark
// events that fall in rain (seven Google pages, cached for 25 minutes by /api/forecast). The Open-Meteo reply
// already holds the whole week.
let dayHoursCache: { at: number; hours: DayHour[] } | null = null;
export async function loadDayHours(): Promise<DayHour[]> {
  if (dayHoursCache && Date.now() - dayHoursCache.at < FORECAST_TTL_MS) return dayHoursCache.hours;
  let hours: DayHour[];
  if (!isLocalHost(window.location.hostname)) {
    if (!openMeteoCache) await loadOpenMeteoForecast();
    hours = openMeteoCache ? openMeteoHours(openMeteoCache) : [];
  } else {
    const res = await fetch('/api/forecast?detail=1', { cache: 'no-store' });
    if (!res.ok) throw new Error(`forecast HTTP ${res.status}`);
    const data = await res.json() as GoogleForecastPayload;
    if (data.ok === false) throw new Error(data.error || 'forecast unavailable');
    hours = googleHours(data.hourly);
  }
  dayHoursCache = { at: Date.now(), hours };
  return hours;
}

// Runs of consecutive hours where rain is likely (40%+), each with its peak chance.
type RainSpan = { from: DayHour; to: DayHour; peak: number };
function rainSpans(hours: DayHour[]): RainSpan[] {
  const spans: RainSpan[] = [];
  for (const h of hours) {
    if (h.precip === null || h.precip < RAIN_ICON_MIN_PCT) continue;
    const last = spans[spans.length - 1];
    if (last && h.hour === last.to.hour + 1) { last.to = h; last.peak = Math.max(last.peak, h.precip); } else spans.push({ from: h, to: h, peak: h.precip });
  }
  return spans;
}
const spanLabel = (s: RainSpan) => (s.from.hour === s.to.hour ? s.from.label : `${s.from.label}–${hourLabel((s.to.hour + 1) % 24)}`);

// A one-line read of a day's rain: the spans where it is likely (40%+), else the day's best chance.
function rainSummary(hours: DayHour[]): string {
  const known = hours.filter((h) => h.precip !== null);
  if (known.length === 0) return '';
  const spans = rainSpans(known);
  if (spans.length > 0) return `Rain likely ${spans.map((s) => `${spanLabel(s)} (${s.peak}%)`).join(', ')}`;
  const peak = known.reduce((a, b) => ((b.precip ?? 0) > (a.precip ?? 0) ? b : a));
  return (peak.precip ?? 0) >= 15 ? `Low chance of rain, up to ${peak.precip}% around ${peak.label}` : 'No rain expected';
}

// A day's waking hours, 7 AM through 10 PM (also the span the collapsed rain summary reads), folded into 3-hour
// blocks (7a, 10a, 1p, 4p, 7p, 10p; the last is just the 10 PM hour). Each block keeps its first hour's temperature
// but takes the block's highest rain chance, and the wettest hour's icon once that is likely, so a short shower isn't
// skipped.
const SLOT_HOURS = 3, SLOT_FIRST_HOUR = 7, SLOT_LAST_HOUR = 22;
function daySlots(hours: DayHour[]): HourPoint[] {
  const slots: HourPoint[] = [];
  for (let start = SLOT_FIRST_HOUR; start <= SLOT_LAST_HOUR; start += SLOT_HOURS) {
    const block = hours.filter((h) => h.hour >= start && h.hour < start + SLOT_HOURS && h.hour <= SLOT_LAST_HOUR);
    if (block.length === 0) continue;
    const wettest = block.reduce((a, b) => ((b.precip ?? -1) > (a.precip ?? -1) ? b : a));
    const rainy = (wettest.precip ?? 0) >= RAIN_ICON_MIN_PCT;
    slots.push({ label: `${start % 12 || 12}${start < 12 ? 'a' : 'p'}`, temp: block[0].temp, icon: rainy ? wettest.icon : block[0].icon, precip: wettest.precip });
  }
  return slots;
}

function useForecast(): Forecast {
  const [forecast, setForecast] = useState<Forecast>(forecastCache?.forecast ?? EMPTY_FORECAST);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (forecastCache && Date.now() - forecastCache.at < FORECAST_TTL_MS) return;
      loadForecast().then((next) => {
        forecastCache = { at: Date.now(), forecast: next };
        if (active) setForecast(next);
      }).catch(() => { /* offline or blocked: the card simply shows no forecast */ });
    };
    refresh();
    const timer = window.setInterval(refresh, FORECAST_TTL_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return forecast;
}

// A full-width row under the current conditions (or under an opened day) that scrolls sideways through every point.
// With fit (Pulse expanded on a wide screen) it is a 12-column grid instead, so every point shows at once and a
// day's 24 hours wrap into two rows. A rain chance of 20% or more shows under the temperature.
// slots is the collapsed week dropdown's: the waking day in six 3-hour blocks, all on screen, with rainy blocks tinted.
function HourlyForecast({ hours, label = 'Hourly forecast', fit = false, slots = false }: { hours: HourPoint[]; label?: string; fit?: boolean; slots?: boolean }) {
  if (hours.length === 0) return null;
  const spansDays = hours.some((h) => h.dayTag);
  const layout = slots ? 'grid grid-cols-6 gap-x-1' : fit ? 'grid grid-cols-12 gap-x-1 gap-y-3' : 'no-scrollbar flex gap-x-1 overflow-x-auto';
  return (
    <ul aria-label={label} style={fit && !slots && hours.length < 12 ? { gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` } : undefined} className={`mt-3 rounded-xl bg-white/[0.03] ${slots ? 'px-1' : 'px-2'} py-2.5 ${layout}`}>
      {hours.map((h, i) => (
        <li key={`${h.label}-${i}`} className={`flex flex-col items-center text-center leading-none ${h.dayTag ? 'border-l border-white/15' : ''} ${slots ? `min-w-0 rounded-lg py-1 ${h.precip !== null && h.precip >= RAIN_ICON_MIN_PCT ? 'bg-[#8db8ee]/[0.12]' : ''}` : fit ? 'min-w-0' : 'w-[2.5rem] shrink-0'}`}>
          {spansDays && <span className="mb-1 h-[0.65rem] text-[0.62rem] font-bold uppercase tracking-[0.06em] text-[#8db8ee]">{h.dayTag ?? ''}</span>}
          <span className="text-[0.72rem] font-semibold text-white/62">{h.label}</span>
          <span aria-hidden="true" className="my-1 text-lg">{h.icon}</span>
          <span className="text-[0.8125rem] font-bold text-white/85">{h.temp}°</span>
          {h.precip !== null && h.precip >= 20 && <span className="mt-1 text-[0.68rem] font-bold text-[#8db8ee]">{h.precip}%</span>}
        </li>
      ))}
    </ul>
  );
}

// The rest of the week: one row per day, with a bar showing that day's low-to-high span against the whole week's range.
// Tapping a day opens its hour-by-hour forecast and a rain summary under that row.
function WeekForecast({ days, fit = false }: { days: DayPoint[]; fit?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [dayHours, setDayHours] = useState<DayHour[] | null>(dayHoursCache?.hours ?? null);
  const [failed, setFailed] = useState(false);
  const toggle = (date: string) => {
    setOpen((cur) => (cur === date ? null : date));
    // loadDayHours answers from its cache while that is fresh, so only the first open (or a stale one) waits on the network.
    setFailed(false);
    loadDayHours().then(setDayHours).catch(() => setFailed(true));
  };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const min = Math.min(...days.map((d) => d.lo)), max = Math.max(...days.map((d) => d.hi));
  const span = Math.max(1, max - min);
  const dayName = (date: string) => date === today ? 'Today' : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return (
    <ul aria-label="7-day forecast" className="mt-3 divide-y divide-white/[0.06] rounded-xl bg-white/[0.03] px-3">
      {days.map((d) => {
        const hrs = open === d.date ? (dayHours ?? []).filter((h) => h.date === d.date) : [];
        return (
        <li key={d.date}>
        <button type="button" aria-expanded={open === d.date} onClick={() => toggle(d.date)} className="grid w-full grid-cols-[2.75rem_1.75rem_2.5rem_1fr_2rem] items-center gap-x-2 rounded-lg py-1.5 text-left text-[0.8125rem] hover:bg-white/[0.03]">
          <span className="font-bold text-white/85">{dayName(d.date)}</span>
          <span aria-hidden="true" className="text-base leading-none">{d.icon}</span>
          <span className={`text-[0.75rem] font-semibold ${d.precip !== null && d.precip >= RAIN_ICON_MIN_PCT ? 'text-[#8db8ee]' : 'text-white/55'}`}>{d.precip !== null && d.precip > 0 ? `${d.precip}%` : ''}</span>
          <div className="flex items-center gap-2">
            <span className="w-7 text-right font-semibold text-[#8db8ee]">{d.lo}°</span>
            <div className="relative h-1.5 flex-1 rounded-full bg-white/[0.08]">
              <span className="absolute inset-y-0 rounded-full bg-gradient-to-r from-[#8db8ee] to-[#f0cb6d]" style={{ left: `${((d.lo - min) / span) * 100}%`, right: `${100 - ((d.hi - min) / span) * 100}%` }} />
            </div>
          </div>
          <span className="text-right font-bold text-[#f0cb6d]">{d.hi}°</span>
        </button>
        {open === d.date && (
          <div className="pb-3">
            {hrs.length > 0 ? (
              <>
                <p className="mt-1 text-[0.75rem] font-semibold text-white/78">{rainSummary(fit ? hrs : hrs.filter((h) => h.hour >= SLOT_FIRST_HOUR && h.hour <= SLOT_LAST_HOUR))}</p>
                {fit
                  ? <HourlyForecast hours={hrs} label={`Hourly forecast for ${dayName(d.date)}`} fit />
                  : <HourlyForecast hours={daySlots(hrs)} label={`3-hour forecast for ${dayName(d.date)}`} slots />}
              </>
            ) : (
              <p className="mt-1 text-[0.75rem] text-white/62">{failed ? 'Hourly forecast unavailable right now.' : dayHours ? 'No hourly forecast for this day yet.' : 'Loading hourly forecast…'}</p>
            )}
          </div>
        )}
        </li>
        );
      })}
    </ul>
  );
}

// Today's temperature from midnight to midnight as a small line graph, with a dot for right now, sized to sit in the
// card's header between the live temperature and the high/low. The hours already past are solid, the forecast ahead
// is dimmer; the live reading is spliced in so the dot always sits on the line. The SVG stretches to the space it
// gets, so the dot and hour labels are HTML placed by percentage to keep them round. In a narrow card (the desktop
// overview's columns) there is no room beside the numbers, so it drops to its own row under them instead.
function TodayGraph({ hours, now, high, low, className = '' }: { hours: DayHour[]; now: number; high: number | null; low: number | null; className?: string }) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const nowHour = (Number(p.hour) % 24) + Number(p.minute) / 60;
  const pts = [...hours.map((h) => ({ x: h.hour, t: h.temp })).filter((q) => Math.abs(q.x - nowHour) >= 0.25), { x: nowHour, t: now }].sort((a, b) => a.x - b.x);
  const temps = [...pts.map((q) => q.t), ...(high !== null ? [high] : []), ...(low !== null ? [low] : [])];
  const tMin = Math.min(...temps), tMax = Math.max(...temps), tSpan = Math.max(4, tMax - tMin);
  const W = 240, H = 60, PAD = 6;
  const X = (hr: number) => (hr / 24) * W;
  const Y = (t: number) => PAD + (1 - (t - tMin) / tSpan) * (H - PAD * 2);
  const line = (qs: typeof pts) => qs.map((q, i) => `${i ? 'L' : 'M'}${X(q.x).toFixed(1)},${Y(q.t).toFixed(1)}`).join('');
  const past = pts.filter((q) => q.x <= nowHour), ahead = pts.filter((q) => q.x >= nowHour);
  const area = `${line(pts)}L${X(pts[pts.length - 1].x).toFixed(1)},${H}L${X(pts[0].x).toFixed(1)},${H}Z`;
  const pct = (hr: number) => `${(hr / 24) * 100}%`;
  // Unique per copy: the card renders one beside the numbers and one under them, and a gradient defined in the
  // hidden copy would not paint the visible one.
  const id = `tg${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <div className={`min-w-0 flex-1 self-stretch py-1 ${className}`} role="img" aria-label={`Today's temperature: now ${now}°${low !== null && high !== null ? `, between a low of ${Math.round(low)}° and a high of ${Math.round(high)}°` : ''}`}>
      <div className="relative h-[2.6rem]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}line`} gradientUnits="userSpaceOnUse" x1="0" y1={PAD} x2="0" y2={H - PAD}>
              <stop offset="0" stopColor="#f0cb6d" />
              <stop offset="0.5" stopColor="#8de0ad" />
              <stop offset="1" stopColor="#8db8ee" />
            </linearGradient>
            <linearGradient id={`${id}fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8de0ad" stopOpacity="0.16" />
              <stop offset="1" stopColor="#8de0ad" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[6, 12, 18].map((hr) => <line key={hr} x1={X(hr)} x2={X(hr)} y1="0" y2={H} stroke="white" strokeOpacity="0.06" vectorEffect="non-scaling-stroke" />)}
          <path d={area} fill={`url(#${id}fill)`} />
          <line x1={X(nowHour)} x2={X(nowHour)} y1="0" y2={H} stroke="white" strokeOpacity="0.25" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          {past.length > 1 && <path d={line(past)} fill="none" stroke={`url(#${id}line)`} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          {ahead.length > 1 && <path d={line(ahead)} fill="none" stroke={`url(#${id}line)`} strokeOpacity="0.5" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0d1310] bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.18)]"
          style={{ left: pct(nowHour), top: `${(Y(now) / H) * 100}%` }}
        />
      </div>
      <div className="relative mt-1 h-3 text-[0.6rem] font-semibold text-white/40">
        {([[6, '6a'], [12, '12p'], [18, '6p']] as const).map(([hr, label]) => (
          <span key={hr} className="absolute -translate-x-1/2" style={{ left: pct(hr) }}>{label}</span>
        ))}
      </div>
    </div>
  );
}

// EPA US AQI bands, each with what it means for getting outside.
function aqiBand(aqi: number): { label: string; advice: string; bg: string; fg: string } {
  if (aqi <= 50) return { label: 'Good', advice: 'Clean air, fine for a run outside', bg: 'bg-[#163426]', fg: 'text-[#8de0ad]' };
  if (aqi <= 100) return { label: 'Moderate', advice: 'Fine outside; ease off hard efforts if the air bothers you', bg: 'bg-[#3b3018]', fg: 'text-[#f0cb6d]' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', advice: 'Keep hard workouts short, or take them inside', bg: 'bg-[#3d2716]', fg: 'text-[#f5a56a]' };
  if (aqi <= 200) return { label: 'Unhealthy', advice: 'Work out indoors today', bg: 'bg-[#3b211b]', fg: 'text-[#ff9d7e]' };
  if (aqi <= 300) return { label: 'Very unhealthy', advice: 'Stay in and keep the windows shut', bg: 'bg-[#33203d]', fg: 'text-[#d6a2ec]' };
  return { label: 'Hazardous', advice: 'Stay in and keep the windows shut', bg: 'bg-[#3d1a24]', fg: 'text-[#ff8fa3]' };
}

// How the air will feel, from the dew point (a steadier comfort gauge than relative humidity, which swings with the
// temperature through the day). warn flags the ends worth doing something about.
function airFeel(dew: number): { headline: string; warn: boolean } {
  if (dew < 35) return { headline: 'Very dry air: drink extra water, and lip balm helps', warn: true };
  if (dew < 50) return { headline: 'Dry and comfortable', warn: false };
  if (dew < 60) return { headline: 'Comfortable, nothing to plan around', warn: false };
  if (dew < 65) return { headline: 'A little sticky outside', warn: false };
  return { headline: 'Muggy: take it easy on hard efforts outside', warn: true };
}

// The rest of today's rain, as what to carry: the likely spans still ahead, else a stray chance, else nothing.
function rainAhead(today: DayHour[], precipIn: number | null): { headline: string; detail: string; warn: boolean } {
  const nowHour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Denver' })) % 24;
  const ahead = today.filter((h) => h.hour >= nowHour && h.precip !== null);
  const amount = precipIn !== null && precipIn >= 0.01 ? ` · ${precipIn.toFixed(2)} in today` : '';
  const spans = rainSpans(ahead);
  if (spans.length > 0) {
    const peak = Math.max(...spans.map((s) => s.peak));
    return { headline: `Umbrella ${spans.map(spanLabel).join(', ')}`, detail: `Rain likely, up to ${peak}%${amount}`, warn: true };
  }
  const top = ahead.reduce<DayHour | null>((a, b) => ((b.precip ?? 0) > (a?.precip ?? 0) ? b : a), null);
  if (top && (top.precip ?? 0) >= 20) return { headline: 'Maybe a stray shower; a light jacket covers it', detail: `Up to ${top.precip}% around ${top.label}${amount}`, warn: false };
  return { headline: 'No umbrella needed', detail: `Dry the rest of today${amount}`, warn: false };
}

// One plain-language line per condition: what to do first, the numbers behind it underneath.
function Readout({ icon, headline, detail, tone = 'text-white/88', badge }: { icon: string; headline: string; detail: string; tone?: string; badge?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span aria-hidden="true" className="w-6 shrink-0 text-center text-lg leading-none">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-[0.8125rem] font-bold leading-snug ${tone}`}>{headline}</p>
        <p className="mt-0.5 text-[0.72rem] text-white/55">{detail}</p>
      </div>
      {badge}
    </li>
  );
}

// Weather for the phone overview's Pulse panel, in two parts: 'now' is the condition icon, live temperature, today's high and low and air quality,
// sized to sit in the panel's header beside its name; 'hours' is the next few forecast points for the panel body. Spans
// only, since both sit inside (or under) the panel's open button.
export function WeatherGlance({ weather, airQuality, observedAt, part }: { weather?: string | null; airQuality?: string | null; observedAt?: string | null; part: 'now' | 'hours' }) {
  const w = parseWeather(weather);
  const { hours, days, current, airQuality: liveAq } = useForecast();
  if (part === 'hours') {
    if (hours.length === 0) return null;
    const strip = hours.slice(0, 6);
    return (
      <span className="grid grid-cols-6 gap-1 rounded-xl bg-white/[0.03] px-1 py-2">
        {strip.map((h, i) => (
          <span key={`${h.label}-${i}`} className={`flex min-w-0 flex-col items-center leading-none ${h.dayTag ? 'border-l border-white/15' : ''}`}>
            {strip.some((x) => x.dayTag) && <span className="mb-1 h-[0.62rem] text-[0.6rem] font-bold uppercase tracking-[0.06em] text-[#8db8ee]">{h.dayTag ?? ''}</span>}
            <span className="text-[0.68rem] font-semibold text-white/62">{h.label}</span>
            <span aria-hidden="true" className="my-1 text-base">{h.icon}</span>
            <span className="text-[0.78rem] font-bold text-white/85">{h.temp}°</span>
          </span>
        ))}
      </span>
    );
  }
  const temp = current?.tempF ?? w?.temp ?? null;
  if (temp === null) return null;
  const condition = current?.condition ?? w?.condition ?? '';
  const icon = current?.isDaytime != null ? conditionIconAt(condition, current.isDaytime) : conditionIcon(condition, observedAt);
  const today = days.find((d) => d.date === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }));
  const high = today?.hi ?? w?.high ?? null, low = today?.lo ?? w?.low ?? null;
  const staticAqi = /US AQIs*(d+)/i.exec(airQuality || '');
  const aqi = liveAq?.aqi ?? (staticAqi ? Number(staticAqi[1]) : null);
  const band = aqi === null ? null : aqiBand(aqi);
  return (
    <span className="flex min-w-0 items-center justify-end gap-2">
      <span role="img" aria-label={condition || 'Current conditions'} className="text-[1.4rem] leading-none">{icon}</span>
      <span className="text-[1.6rem] font-semibold leading-none tracking-[-0.05em] text-white/95">{Math.round(temp)}°</span>
      {high !== null && low !== null && (
        <span className="shrink-0 text-[0.72rem] font-bold leading-tight">
          <span className="block text-[#f0cb6d]">H {Math.round(high)}°</span>
          <span className="block text-[#8db8ee]">L {Math.round(low)}°</span>
        </span>
      )}
      {band && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.68rem] font-bold ${band.bg} ${band.fg}`}>AQI {aqi}</span>}
    </span>
  );
}

// onClose is the phone's: there, tapping the current weather closes Pulse and only the day graph opens the week, so
// the row is two buttons instead of one. Elsewhere the whole row opens the week.
export function ConditionsCard({ weather, airQuality, observed, observedAt, expanded = false, onClose }: { weather?: string | null; airQuality?: string | null; observed?: string | null; observedAt?: string | null; expanded?: boolean; onClose?: () => void }) {
  const w = parseWeather(weather);
  const staticAqiMatch = /US AQI\s*(\d+)/i.exec(airQuality || '');
  const staticPm = /PM2\.5\s*(\d+(?:\.\d+)?)/i.exec(airQuality || '');
  const { hours, today, days, current, airQuality: liveAq } = useForecast();
  const [weekOpen, setWeekOpen] = useState(false);
  // The Pulse producer's weather/AQ lines only update when it runs (can be stale by an hour or more), so prefer
  // the local dashboard's live Google reading for every field it covers, falling back to the producer's snapshot.
  const liveTemp = current?.tempF ?? w?.temp ?? null;
  const condition = current?.condition ?? w?.condition ?? '';
  const icon = current?.isDaytime != null ? conditionIconAt(condition, current.isDaytime) : conditionIcon(condition, observedAt);
  const humidity = current?.humidityPct ?? w?.humidity ?? null;
  const dew = current?.dewPointF ?? w?.dew ?? null;
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const todayForecast = days.find((d) => d.date === todayKey);
  // Today's expected rain amount; the chance of rain is already on the week forecast's Today row.
  const precipIn = todayForecast?.precipIn ?? null;
  const high = todayForecast?.hi ?? w?.high ?? null;
  const low = todayForecast?.lo ?? w?.low ?? null;
  const aqi = liveAq?.aqi ?? (staticAqiMatch ? Number(staticAqiMatch[1]) : null);
  const pm25 = liveAq?.pm25 ?? (staticPm ? Number(staticPm[1]) : null);
  const band = aqi === null ? null : aqiBand(aqi);
  const feelsLike = current?.feelsLikeF ?? null;
  const feel = dew !== null ? airFeel(dew) : null;
  const rain = liveTemp !== null && (today.length > 0 || precipIn !== null) ? rainAhead(today, precipIn) : null;

  const now = (
    <div className="flex shrink-0 items-center gap-3">
      <span aria-hidden="true" className="text-[2rem] leading-none">{icon}</span>
      <div>
        <p className="text-[2.1rem] font-semibold leading-none tracking-[-0.05em]">{liveTemp}°</p>
        {condition && <p className="mt-1 text-xs font-semibold capitalize text-white/78">{condition}</p>}
      </div>
    </div>
  );
  // The day graph: beside the numbers when the card is wide enough, under them otherwise. On the phone each copy is
  // the button that opens the week.
  const graph = (where: 'beside' | 'under') => {
    if (today.length < 2 || liveTemp === null) return null;
    const visibility = where === 'beside' ? 'hidden @[18rem]:block' : `${onClose ? '' : 'mt-2 '}@[18rem]:hidden`;
    if (!onClose || days.length === 0) return <TodayGraph hours={today} now={liveTemp} high={high} low={low} className={visibility} />;
    return (
      <button type="button" aria-expanded={weekOpen} aria-label="Show the forecast for the rest of the week" onClick={() => setWeekOpen((v) => !v)}
        className={`min-w-0 flex-1 self-stretch rounded-xl text-left outline-offset-4 ${where === 'under' ? 'mt-2 w-full ' : ''}${visibility}`}>
        <TodayGraph hours={today} now={liveTemp} high={high} low={low} />
      </button>
    );
  };
  const highLow = high !== null && low !== null && (
    <div className="shrink-0 text-right text-xs leading-5">
      <p><span className="text-white/62">High</span> <strong className="text-[#f0cb6d]">{Math.round(high)}°</strong></p>
      <p><span className="text-white/62">Low</span> <strong className="text-[#8db8ee]">{Math.round(low)}°</strong></p>
    </div>
  );

  return (
    <div className="mt-5 border-t border-white/[0.07] pt-4">
      {liveTemp !== null ? (
        <div className="@container mt-3">
          {onClose ? (
            <div className="flex items-center justify-between gap-3">
              <button type="button" aria-label="Close Pulse" onClick={onClose} className="shrink-0 rounded-xl text-left outline-offset-4">{now}</button>
              {graph('beside')}
              {highLow}
            </div>
          ) : (
            <div
              role="button"
              tabIndex={days.length > 0 ? 0 : -1}
              aria-expanded={days.length > 0 ? weekOpen : undefined}
              aria-label={days.length > 0 ? 'Show the forecast for the rest of the week' : undefined}
              onClick={() => { if (days.length > 0) setWeekOpen((v) => !v); }}
              onKeyDown={(e) => { if (days.length > 0 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setWeekOpen((v) => !v); } }}
              className={`flex items-center justify-between gap-3 rounded-xl ${days.length > 0 ? 'cursor-pointer outline-offset-4 hover:bg-white/[0.03]' : ''}`}
            >
              {now}
              {graph('beside')}
              {highLow}
            </div>
          )}
          {graph('under')}
          <HourlyForecast hours={hours} fit={expanded} />
          {weekOpen && days.length > 0 && <WeekForecast days={days} fit={expanded} />}
          {days.length > 0 && (
            <button type="button" aria-expanded={weekOpen} onClick={() => setWeekOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-[0.75rem] font-bold text-white/62 hover:text-white/85">
              {weekOpen ? 'Hide week' : 'Rest of the week'}
              <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-2.5 w-2.5 transition-transform ${weekOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
            </button>
          )}
          {today.length < 2 && high !== null && low !== null && high > low && (
            <div className="mt-3" role="img" aria-label={`Now ${liveTemp}°, between a low of ${Math.round(low)}° and a high of ${Math.round(high)}°`}>
              <div className="relative h-1.5 rounded-full bg-gradient-to-r from-[#8db8ee] via-[#8de0ad] to-[#f0cb6d]">
                <span
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0d1310] bg-white"
                  style={{ left: `${Math.min(100, Math.max(0, ((liveTemp - low) / (high - low)) * 100))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        weather && <p className="mt-2 text-xs leading-5 text-white/70">{weather}</p>
      )}

      {(feel || rain || band) && (
        <ul aria-label="What today's weather means" className="mt-3 divide-y divide-white/[0.06] rounded-xl bg-white/[0.03] px-3">
          {rain && <Readout icon={rain.warn ? RAINY_ICON : '🌂'} headline={rain.headline} detail={rain.detail} tone={rain.warn ? 'text-[#8db8ee]' : undefined} />}
          {feel && dew !== null && (
            <Readout icon={feel.warn ? '💧' : '🙂'} headline={feel.headline} tone={feel.warn ? 'text-[#f0cb6d]' : undefined}
              detail={[`Dew point ${Math.round(dew)}°`, humidity !== null ? `humidity ${Math.round(humidity)}%` : null, feelsLike !== null && liveTemp !== null && Math.abs(feelsLike - liveTemp) >= 3 ? `feels like ${feelsLike}°` : null].filter(Boolean).join(' · ')} />
          )}
          {band && aqi !== null && (
            <Readout icon="🏃" headline={band.advice} tone={aqi > 50 ? band.fg : undefined}
              detail={`Air quality ${band.label.toLowerCase()}${pm25 !== null ? ` · PM2.5 ${pm25.toFixed(1)} µg/m³` : ''}`}
              badge={<span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.72rem] font-bold ${band.bg} ${band.fg}`}>AQI {aqi}</span>} />
          )}
        </ul>
      )}
      {!band && airQuality && <p className="mt-2 text-xs leading-5 text-white/70">{airQuality}</p>}
      {current ? (
        <p className="mt-2 text-[0.75rem] text-white/62">Live · {current.source}</p>
      ) : (
        observed && <p className="mt-2 text-[0.75rem] text-white/62">{observed}</p>
      )}
    </div>
  );
}

/* ---------- Body-composition charts ---------- */

const DAY = 86400000;
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const shortDate = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

interface Panel {
  key: string;
  label: string;
  unit: string;
  color: string;
  latest: number;
  latestDate: string;
  perWeek?: number;
  steady: number; // weekly change smaller than this reads as "holding steady"
  good: 'up' | 'down' | null; // which direction is an improvement; null = no judgement
  series: Array<{ t: number; v: number }>;
}

function trendOf(p: Panel): { text: string; tone: string } | null {
  if (typeof p.perWeek !== 'number') return null;
  if (Math.abs(p.perWeek) < p.steady) return { text: 'Holding steady', tone: 'text-white/72' };
  const up = p.perWeek > 0;
  const tone = p.good === null ? 'text-white/70' : up === (p.good === 'up') ? 'text-[#8de0ad]' : 'text-[#f0cb6d]';
  return { text: `${up ? '+' : '−'}${Math.abs(p.perWeek).toFixed(1)} ${p.unit}/wk`, tone };
}

function MetricChart({ p, t0, t1, note }: { p: Panel; t0: number; t1: number; note?: string }) {
  // Single readings swing (bio-impedance scales especially), so the line is a trailing 7-day average with the raw readings behind it.
  const avg = p.series.map((pt) => {
    const win = p.series.filter((q) => q.t <= pt.t && q.t > pt.t - 7 * DAY);
    return { t: pt.t, v: win.reduce((s, q) => s + q.v, 0) / win.length };
  });
  const W = 300, H = 58, padL = 26, padR = 8, padT = 5, padB = 5;
  const lo = Math.floor(Math.min(...p.series.map((q) => q.v))), hi = Math.ceil(Math.max(...p.series.map((q) => q.v)));
  const span = Math.max(1, hi - lo);
  const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  const line = avg.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)} ${y(q.v).toFixed(1)}`).join(' ');
  const end = avg[avg.length - 1];
  const trend = trendOf(p);
  return (
    <div className="mt-3 first:mt-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
            <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-white/72">{p.label}</p>
          </div>
          {note && <p className="ml-4 text-[0.75rem] leading-4 text-white/62">{note}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-semibold leading-none tracking-[-0.03em]">{p.unit === 'bpm' ? Math.round(p.latest) : p.latest.toFixed(1)}<span className="ml-0.5 text-[0.8125rem] font-semibold text-white/72">{p.unit === 'pts' ? '%' : p.unit}</span></p>
          {trend && <p className={`mt-1 whitespace-nowrap text-[0.8125rem] font-semibold leading-none ${trend.tone}`}>{trend.text}</p>}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${p.label}, ${shortDate(t0)} to ${shortDate(t1)}: 7-day average now ${end.v.toFixed(1)}`}>
        {[lo, hi].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-white/[0.07]" />
            <text x={padL - 5} y={y(v) + 3} textAnchor="end" className="fill-white/35" fontSize="9">{v}</text>
          </g>
        ))}
        {p.series.map((q) => <circle key={q.t} cx={x(q.t)} cy={y(q.v)} r="1.8" className="fill-white/25" />)}
        <path d={line} fill="none" stroke={p.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(end.t)} cy={y(end.v)} r="3.2" fill={p.color} stroke="#1a0f15" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function BodyCharts({ weight }: { weight: NonNullable<PulseHealth['weight']> }) {
  const toSeries = <T extends { d: string }>(rows: T[] | undefined, pick: (r: T) => number) =>
    (rows ?? []).map((r) => ({ t: dayMs(r.d), v: pick(r) })).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v));
  const panels: Panel[] = [
    { key: 'weight', label: 'Weight', unit: 'lb', color: '#f472b6', latest: weight.latestLb, latestDate: weight.latestDate, perWeek: weight.lbPerWeek, steady: 0.25, good: null, series: toSeries(weight.series, (r) => r.lb) },
    ...(weight.bodyFat ? [{ key: 'fat', label: 'Body fat', unit: 'pts', color: '#f0cb6d', latest: weight.bodyFat.latest, latestDate: weight.bodyFat.latestDate, perWeek: weight.bodyFat.perWeek, steady: 0.15, good: 'down' as const, series: toSeries(weight.bodyFat.series, (r) => r.pct) }] : []),
    ...(weight.muscle ? [{ key: 'muscle', label: 'Skeletal muscle', unit: 'lb', color: '#8de0ad', latest: weight.muscle.latest, latestDate: weight.muscle.latestDate, perWeek: weight.muscle.perWeek, steady: 0.15, good: 'up' as const, series: toSeries(weight.muscle.series, (r) => r.lb) }] : []),
  ].filter((p) => p.series.length >= 2);
  if (!panels.length) return null;
  const t0 = Math.min(...panels.map((p) => p.series[0].t));
  const t1 = Math.max(...panels.map((p) => p.series[p.series.length - 1].t));
  const stale = (p: Panel) => t1 - dayMs(p.latestDate) > 1.5 * DAY;
  const lagging = panels.filter((p) => p.key === 'muscle' && stale(p));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-white/62">Body composition</p>
        <p className="text-[0.75rem] text-white/62">{shortDate(t0)} – {shortDate(t1)}</p>
      </div>
      {panels.map((p) => <MetricChart key={p.key} p={p} t0={t0} t1={t1} note={stale(p) ? `as of ${shortDate(dayMs(p.latestDate))}` : undefined} />)}
      <p className="mt-2 text-[0.75rem] leading-4 text-white/62">
        Lines are 7-day averages; dots are single readings.{lagging.length > 0 ? ' Skeletal muscle comes from Samsung Health and can trail the scale by a few days.' : ''}
      </p>
    </div>
  );
}

/* ---------- Heart rate ---------- */

function HeartCharts({ heart }: { heart: NonNullable<PulseHealth['heartRate']> }) {
  const series = heart.series.map((r) => ({ t: dayMs(r.d), v: r.bpm })).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v));
  if (series.length < 2) return null;
  const panel: Panel = { key: 'hr', label: 'Workout heart rate', unit: 'bpm', color: '#ff8fa3', latest: heart.latest, latestDate: heart.latestDate, perWeek: heart.perWeek, steady: 0.5, good: 'down', series };
  const last = heart.series[heart.series.length - 1];
  return (
    <div className="mt-4 border-t border-white/[0.07] pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-white/62">Heart rate</p>
        {typeof heart.vo2max === 'number' && <p className="text-[0.75rem] text-white/62">VO2 max {heart.vo2max.toFixed(1)}</p>}
      </div>
      <MetricChart p={panel} t0={series[0].t} t1={series[series.length - 1].t} note={`Last: ${last.label === 'Run' ? 'run' : `Workout ${last.label}`}, peak ${last.max} bpm`} />
      {heart.zones && heart.zones.length > 0 && (
        <ul aria-label="Heart-rate zones" className="mt-2 grid grid-cols-5 gap-1 text-center">
          {heart.zones.map((z) => (
            <li key={z.zone} className={`rounded-lg px-1 py-1.5 ${z.zone === 2 ? 'bg-[#163426] text-[#8de0ad]' : 'bg-white/[0.04] text-white/72'}`}>
              <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.06em]">Z{z.zone}</p>
              <p className="text-[0.72rem] font-semibold">{z.low}–{z.high}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[0.75rem] leading-4 text-white/62">
        Average heart rate per lift or run; lower at the same work means fitter. Zones come from your highest recorded heart rate ({heart.maxHr ?? '—'} bpm) and rise as you log harder efforts.
      </p>
    </div>
  );
}

/* ---------- Today's session ---------- */

const denverMinutes = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
};
const clockMinutes = (at: string | undefined) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(at || '');
  return m ? ((Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]) : null;
};

// The week as the plan wrote it at 6:30 AM, except that late at night a run still not logged moves onto tomorrow when
// tomorrow is a rest day, the same carry-over the producer applies the next morning.
type WeekDay = NonNullable<PulsePlan['week']>[number] & { carried?: boolean };
function carriedWeek(plan: PulsePlan, done: boolean, now: number): WeekDay[] | undefined {
  const week = plan.week;
  const running = plan.kind === 'easy' || plan.kind === 'long';
  if (!week || week.length < 2 || done || !running || now < 21 * 60 || week[1].plan !== 'Rest / walk') return week;
  return [week[0], { ...week[1], plan: plan.kind === 'long' ? 'Long run' : 'Easy run', carried: true }, ...week.slice(2)];
}

// The first line of the brief: what to do today and when. The plan is written at 6:30 AM, so the phrasing follows the
// clock (scheduled, still to do, or tomorrow's plan late at night); a run also gets the forecast for its start hour.
function useSessionLine(plan: PulsePlan | null | undefined, health: PulseHealth | null, briefDate: string | undefined) {
  const { today } = useForecast();
  const [now, setNow] = useState(denverMinutes);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(denverMinutes()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const todayKey = denverToday();
  if (!plan || briefDate !== todayKey) return null;
  // Runs are in the morning and lifts at 4 PM; once the morning run is logged, a day's afternoon lift is the session.
  const lifted = health?.lastLiftDate === todayKey, ran = health?.lastRunDate === todayKey;
  if (plan.lift && ran && !lifted) {
    plan = { kind: 'lift', title: plan.lift.title, session: plan.lift.session, at: plan.lift.at, detail: 'Morning run logged. The lift is this afternoon.', week: plan.week };
  }
  const done = plan.kind === 'done' || lifted || (ran && !plan.lift && plan.kind !== 'lift');
  const week = carriedWeek(plan, done, now);
  const tomorrow = week?.[1];
  if (now >= 21 * 60 && tomorrow) {
    const detail = done ? 'Today is logged.' : tomorrow.carried ? "Today's run wasn't logged, so it moves to tomorrow's rest day." : '';
    return { week, eyebrow: 'Tomorrow', title: tomorrow.plan, detail, weather: '', short: { label: 'Tomorrow', text: `${tomorrow.plan}. ${detail}`.trim(), specifics: '' } };
  }
  if (done) {
    const detail = tomorrow ? `Tomorrow: ${tomorrow.plan.toLowerCase()}.` : '';
    return { week, eyebrow: 'Today', title: 'Done for today', detail, weather: '', short: { label: 'Done today', text: `Logged. ${detail}`.trim(), specifics: '' } };
  }
  const start = clockMinutes(plan.at);
  const running = plan.kind === 'easy' || plan.kind === 'long';
  // The label names the session, plus its start time until that has passed.
  const upcoming = start !== null && now < start;
  const eyebrow = `${running ? (plan.kind === 'long' ? 'Long run' : 'Run') : plan.kind === 'lift' ? plan.title : plan.kind === 'recover' ? 'Recovery' : 'Rest day'}${upcoming ? ` · ${plan.at}` : ''}`;
  const title = running ? `You're scheduled to run${plan.minutes ? ` ${plan.minutes} min` : ''}` : plan.kind === 'lift' ? `You're scheduled for ${plan.title}` : plan.title;
  const hour = upcoming ? Math.floor((start ?? 0) / 60) : Math.floor(now / 60) + 1;
  const at = running ? today.find((h) => h.hour === hour) : undefined;
  const weather = at ? `${at.icon} ${at.temp}° at ${at.label}${at.precip !== null && at.precip >= 20 ? ` · ${at.precip}% rain` : ''}` : '';
  // The phone home screen's closed tile: the label, then everything in plain running text, like the feeds tile.
  const minutes = running && plan.minutes ? ` ${plan.minutes} min` : '';
  const label = `${eyebrow.replace(/^(Long run|Run)/, `$1${minutes}`)}`;
  const specifics = [running && plan.hrLow && plan.hrHigh ? `Zone ${plan.zone ?? 2}, ${plan.hrLow}–${plan.hrHigh} bpm` : '', weather].filter(Boolean).join(' · ');
  return { week, eyebrow, title, detail: plan.detail, weather, short: { label, text: encouragement(health), specifics } };
}

// The closed phone tile's line: what is going right, from the same fitted weekly trends the charts show. Only
// movement in the good direction is mentioned (each trend's "holding steady" threshold applies), so it never cheers
// a number that is not really moving.
function encouragement(health: PulseHealth | null): string {
  const wins: string[] = [];
  const w = health?.weight;
  const muscle = w?.muscle?.perWeek, fat = w?.bodyFat?.perWeek, hr = health?.heartRate?.perWeek;
  const steadyWeight = typeof w?.lbPerWeek === 'number' && Math.abs(w.lbPerWeek) < 0.25;
  if (typeof muscle === 'number' && muscle >= 0.15) wins.push(`Muscle is up ${muscle.toFixed(1)} lb a week${steadyWeight ? ' while your weight holds steady' : ''}`);
  if (typeof fat === 'number' && fat <= -0.15) wins.push(`body fat is down ${Math.abs(fat).toFixed(1)} points a week`);
  if (typeof hr === 'number' && hr <= -0.5) wins.push(`your workout heart rate is dropping ${Math.abs(hr).toFixed(1)} bpm a week`);
  const ready = (health?.progression ?? []).filter((t) => t.action === 'increase').length;
  const parts = wins.length ? [`${wins.join(', and ').replace(/^./, (c) => c.toUpperCase())}.`] : [];
  if (ready) parts.push(`${ready} of your lifts ${ready === 1 ? 'is' : 'are'} ready for more weight.`);
  return parts.length ? parts.join(' ') : 'Every session you log sharpens the trend. Show up today and it counts.';
}

function WeekPlan({ week }: { week: WeekDay[] | undefined }) {
  if (!week?.length) return null;
  return (
    <ul aria-label="This week's plan" className="mt-2 grid grid-cols-7 gap-1 text-center">
      {week.map((d, i) => (
        <li key={d.date} className={`rounded-lg px-0.5 py-1.5 ${i === 0 ? 'bg-[#f472b6]/15 text-white/90' : 'bg-white/[0.04] text-white/72'}`}>
          <p className="text-[0.68rem] font-extrabold uppercase">{d.dow}</p>
          <p className="mt-0.5 text-[0.62rem] font-semibold leading-3">{d.plan.replace(' / walk', '')}</p>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Training targets ---------- */

function Targets({ health }: { health: PulseHealth }) {
  const rows = health.progression ?? [];
  if (!rows.length) return null;
  const pushing = rows.filter((r) => r.action === 'increase').length;
  return (
    <div className="mt-4 border-t border-white/[0.07] pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-[#f472b6]">{health.nextWorkout ? `Workout ${health.nextWorkout} targets` : 'Next targets'}</p>
        <p className="text-[0.75rem] text-white/62">{pushing} of {rows.length} ready for more load</p>
      </div>
      <ul className="mt-1 divide-y divide-white/[0.06]">
        {rows.map((r) => {
          const u = unitLabel(r.unit);
          return (
            <li key={r.exercise} className="py-2">
              <div className="flex items-start justify-between gap-3">
                <h5 className="text-[0.875rem] font-bold leading-snug">{r.exercise}</h5>
                {r.action === 'increase' && (
                  <span className="shrink-0 whitespace-nowrap text-[0.875rem] font-bold text-[#8de0ad]">{fmt(r.lastLoad)} → {fmt(r.nextLoad)} {u} <span className="rounded bg-[#163426] px-1 py-0.5 text-[0.75rem]">+{fmt(r.step)}</span></span>
                )}
                {r.action === 'hold' && <span className="shrink-0 whitespace-nowrap text-[0.875rem] font-bold text-white/80">Stay at {fmt(r.lastLoad)} {u}</span>}
                {r.action === 'reps' && <span className="shrink-0 whitespace-nowrap text-[0.875rem] font-bold text-white/80">Bodyweight</span>}
              </div>
              <p className="mt-0.5 text-[0.8125rem] leading-4 text-white/72">
                {r.action === 'increase' && `Hit ${r.lastReps} reps last time, so add ${fmt(r.step)} ${u} and aim for ${r.targetReps}+ reps.`}
                {r.action === 'hold' && `Got ${r.lastReps} reps last time; aim for ${r.targetReps} before adding load.`}
                {r.action === 'reps' && `Did ${r.lastReps} reps last time; aim for ${r.targetReps}.`}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- Collapsible morning brief ---------- */

type FeedParagraph = NonNullable<PulseMorningBrief['rss']>[number];

// A paragraph of the feed rundown; the links under it are the feed items it covers, straight from the feed.
function FeedLinks({ links }: { links: FeedParagraph['links'] }) {
  const safe = links.filter((l) => /^https?:\/\//i.test(l.url));
  if (!safe.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {safe.map((l) => (
        <li key={l.url} className="truncate text-[0.8125rem] leading-5">
          <a href={l.url} target="_blank" rel="noreferrer" className="font-semibold text-[#f9a8d4] hover:underline">{l.title}</a>
          {l.source && <span className="text-white/65"> · {l.source}</span>}
        </li>
      ))}
    </ul>
  );
}

// Clicking anywhere in an opened card closes it, like its summary does; links and buttons keep their own clicks.
function closeOnClick(e: { target: EventTarget }, card: HTMLDetailsElement | null) {
  if (card && !(e.target as HTMLElement).closest('a, button, input, select, textarea')) card.open = false;
}

const chevron = <svg aria-hidden="true" viewBox="0 0 12 12" className="mt-1 h-3 w-3 shrink-0 text-white/72 transition-transform group-open:rotate-90"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// Today's session and when to do it; opens to the week, body composition, heart rate and lift targets.
function WorkoutCard({ brief, compact, wide, span, onToggle }: { brief: PulseMorningBrief; compact: boolean; wide: boolean; span: boolean; onToggle: (open: boolean) => void }) {
  const sections = brief.sections;
  const health = brief.health ?? null;
  const session = useSessionLine(health?.plan, health, brief.date);
  const ref = useRef<HTMLDetailsElement>(null);
  if (!sections?.bestAction && !sections?.healthTraining && !health) return null;
  const weight = health?.weight ?? null;
  return (
    <details data-own-click ref={ref} onToggle={(e) => onToggle(e.currentTarget.open)} className={`group min-w-0 rounded-2xl border border-[#f472b6]/15 bg-[#1a0f15] ${compact ? 'min-h-0 flex-1 overflow-hidden open:flex-none open:overflow-visible' : ''} ${wide ? 'mt-5' : ''} ${span ? 'xl:col-span-2 xl:not-open:order-first' : ''}`}>
      <summary className={`flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden ${compact ? 'px-3 py-2.5' : 'p-4'}`}>
        <div className="min-w-0 flex-1">
          {session ? (
            <>
              {compact && session.short && (
                // The closed tile's wording; opening the card swaps in the full sentences below.
                <div className="group-open:hidden">
                  <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-[#f472b6]">{session.short.label}</p>
                  <p className="mt-1 line-clamp-7 text-[0.8125rem] leading-5 text-white/80">{session.short.text}</p>
                  {session.short.specifics && <p className="mt-1.5 text-[0.8125rem] leading-5 text-white/62">{session.short.specifics}</p>}
                </div>
              )}
              <div className={compact && session.short ? 'hidden group-open:block' : ''}>
                {session.eyebrow && <p className="mb-1 text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-[#f472b6]">{session.eyebrow}</p>}
                <h4 className="text-base font-bold leading-snug">{session.title}</h4>
                {session.detail && <p className="mt-0.5 text-[0.8125rem] leading-5 text-white/80">{session.detail}</p>}
                {session.weather && <p className="mt-0.5 text-[0.8125rem] font-semibold leading-5 text-white/72">{session.weather}</p>}
              </div>
            </>
          ) : (
            sections?.bestAction && <h4 className="text-sm font-bold leading-snug">{sections.bestAction}</h4>
          )}
          {/* The week is on the card's face, so it shows without opening the card. */}
          {health?.plan && <WeekPlan week={session?.week ?? health.plan.week} />}
        </div>
        {chevron}
      </summary>
      {/* Open across the whole row, the targets and heart rate sit side by side with the body composition under them. */}
      <div className={`cursor-pointer border-t border-white/[0.06] px-4 pb-4 pt-3 ${span ? 'xl:grid xl:grid-cols-2 xl:items-start xl:gap-x-6 [&>*]:xl:mt-0 [&>*]:xl:border-t-0 [&>*]:xl:pt-0 [&>*:nth-child(n+3)]:xl:col-span-2 [&>*:nth-child(n+3)]:xl:mt-4 [&>*:nth-child(n+3)]:xl:border-t [&>*:nth-child(n+3)]:xl:pt-3' : ''}`} onClick={(e) => closeOnClick(e, ref.current)}>
        {/* Today's lift targets and workout heart rate first; the body-composition trends sit below them. */}
        {health && <Targets health={health} />}
        {health?.heartRate && <HeartCharts heart={health.heartRate} />}
        {weight ? (
          <div className="mt-4 border-t border-white/[0.07] pt-3 first:mt-0 first:border-t-0 first:pt-0"><BodyCharts weight={weight} /></div>
        ) : (
          sections?.healthTraining && !health && <p className="text-xs leading-5 text-white/72">{sections.healthTraining}</p>
        )}
        {health?.steps && <p className="mt-3 text-[0.8125rem] text-white/72">{health.steps} steps yesterday.</p>}
      </div>
    </details>
  );
}

// The written rundown of the RSS feeds: closed, a teaser of the first paragraph; open, every paragraph with its links.
function FeedCard({ feed, compact, wide, span, onToggle }: { feed: FeedParagraph[]; compact: boolean; wide: boolean; span: boolean; onToggle: (open: boolean) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  if (!feed.length) return null;
  const stories = new Set(feed.flatMap((p) => p.links.map((l) => l.url))).size;
  return (
    <details data-own-click ref={ref} onToggle={(e) => onToggle(e.currentTarget.open)} className={`group min-w-0 shrink-0 rounded-2xl border border-[#8db8ee]/15 bg-[#0f1520] ${wide ? 'mt-5' : ''} ${span ? 'xl:col-span-2 xl:not-open:order-first' : ''}`}>
      <summary className={`flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden ${compact ? 'px-3 py-2 group-open:py-2.5' : 'p-4'}`}>
        <div className="min-w-0">
          {compact && (
            // The phone's closed card is a one-line bar under the workout; opening it gives the rundown.
            <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-[#8db8ee] group-open:hidden">Feeds{stories > 0 && <span className="font-bold normal-case tracking-normal text-white/55"> · {stories} {stories === 1 ? 'story' : 'stories'}</span>}</p>
          )}
          <div className={compact ? 'hidden group-open:block' : ''}>
            <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.1em] text-[#8db8ee]">From your feeds{stories ? <span className="font-bold normal-case tracking-normal text-white/55"> · {stories} {stories === 1 ? 'story' : 'stories'}</span> : null}</p>
            <p className={`mt-1.5 text-[0.9375rem] leading-6 text-white/90 ${compact ? '' : 'line-clamp-4 group-open:line-clamp-none'}`}>{feed[0].text}</p>
          </div>
        </div>
        {chevron}
      </summary>
      {/* Open across the whole row, the stories flow in two columns instead of one long, wide one. */}
      <div className={`cursor-pointer border-t border-white/[0.06] px-4 pb-4 pt-3 ${span ? 'space-y-4 xl:columns-2 xl:gap-x-8 xl:space-y-0 [&>*]:xl:mb-4 [&>*]:xl:break-inside-avoid' : 'space-y-4'}`} onClick={(e) => closeOnClick(e, ref.current)}>
        <FeedLinks links={feed[0].links} />
        {feed.slice(1).map((p, i) => (
          <div key={i}>
            <p className="text-[0.9375rem] leading-6 text-white/90">{p.text}</p>
            <FeedLinks links={p.links} />
          </div>
        ))}
      </div>
    </details>
  );
}

// Today's workout and the feed rundown, as two cards that open separately. `compact` is the phone home screen's
// copy, tucked under the weather; onToggle tells the overview while either card is open so the Pulse panel can
// grow to fit it. `wide` is the expanded desktop lane: both cards start closed and sit as columns of the parent's grid;
// with just one of them open, each takes the whole row so the open one isn't beside an empty column, and the closed
// one moves above it so it stays in reach without scrolling past the open one.
export function MorningBrief({ brief, compact = false, wide = false, onToggle }: { brief: PulseMorningBrief | null | undefined; compact?: boolean; wide?: boolean; onToggle?: (open: boolean) => void }) {
  const [open, setOpen] = useState({ workout: false, feed: false });
  useEffect(() => { onToggle?.(open.workout || open.feed); }, [open, onToggle]);
  if (!brief) return null;
  const feed = (brief.rss ?? []).filter((p) => p.text);
  const span = wide && open.workout !== open.feed && feed.length > 0;
  return (
    // On the phone the workout fills the panel and the feeds sit under it as a one-line bar.
    <div className={compact ? 'flex h-full flex-col gap-2' : wide ? 'contents' : 'mt-5 space-y-2'}>
      <WorkoutCard brief={brief} compact={compact} wide={wide} span={span} onToggle={(o) => setOpen((s) => ({ ...s, workout: o }))} />
      <FeedCard feed={feed} compact={compact} wide={wide} span={span} onToggle={(o) => setOpen((s) => ({ ...s, feed: o }))} />
    </div>
  );
}
