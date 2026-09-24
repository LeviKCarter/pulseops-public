// Cross-checks events against the hourly forecast so the Events lane can flag the ones likely to get rained on.
// Day keys and hours are Denver wall-clock on both sides: event starts are ledger times, and the forecast's DayHour
// entries are already placed on their Denver day and hour.
import type { DayHour } from './PulseBrief';

// The same bar the forecast uses before it shows an umbrella instead of a cloud.
export const EVENT_RAIN_MIN_PCT = 40;
// An event with no end time is checked for this many hours from its start.
const DEFAULT_EVENT_HOURS = 2;
// All-day (or time-TBA) events are checked over the waking day, matching the forecast card's 7 AM–10 PM span.
const DAY_FIRST_HOUR = 7, DAY_LAST_HOUR = 22;

export interface EventRain { peak: number; icon: string; label: string }

type When = { day: string; mins: number | null };

// The wettest forecast hour an event overlaps, when rain is likely then (40%+); null when it's dry or unforecast.
// Only the start day is checked: a multi-day event (a festival) is flagged by its opening day's weather.
export function eventRain(hours: DayHour[], start: When, end: When | null): EventRain | null {
  let from: number, to: number;
  if (start.mins === null) {
    [from, to] = [DAY_FIRST_HOUR, DAY_LAST_HOUR];
  } else {
    from = Math.floor(start.mins / 60);
    const endMins = end && end.day === start.day && end.mins !== null && end.mins > start.mins ? end.mins : start.mins + DEFAULT_EVENT_HOURS * 60;
    to = Math.min(23, Math.ceil(endMins / 60) - 1); // an event ending at 9:00 PM doesn't touch the 9 PM hour
  }
  const covered = hours.filter((h) => h.date === start.day && h.hour >= from && h.hour <= to && h.precip !== null);
  if (covered.length === 0) return null;
  const wettest = covered.reduce((a, b) => ((b.precip ?? 0) > (a.precip ?? 0) ? b : a));
  if ((wettest.precip ?? 0) < EVENT_RAIN_MIN_PCT) return null;
  // A likely-rain hour Google still calls "cloudy" gets the umbrella; storm and snow keep their own icons.
  return { peak: wettest.precip ?? 0, icon: /☔|⛈️|❄️/u.test(wettest.icon) ? wettest.icon : '☔', label: wettest.label };
}
