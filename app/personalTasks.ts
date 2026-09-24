// Opt-in overlay of the viewer's own Google Tasks (the ones with a due date, which Google Calendar also shows)
// on top of the event ledger. Google's calendar ICS feeds never include tasks, so they come from a small Apps
// Script web app running in the viewer's own Google account (scripts/google-tasks-feed.gs): unlike an OAuth
// token for an unpublished Cloud app, it never expires. Its URL is configured in PERSONAL_TASKS_URL (local-only
// env, never committed) and is as private as the calendar ICS links: anyone holding it can read the tasks.
import type { EventItem } from './UpcomingEvents';

interface FeedTask { id?: string; listId?: string; title?: string; due?: string; list?: string; webViewLink?: string }

const feedUrl = () => {
  const url = process.env.PERSONAL_TASKS_URL?.trim();
  return url && /^https:\/\//i.test(url) ? url : null;
};

// Marks one task complete through the same Apps Script (its doPost). Completed, not deleted, so it can be undone
// in Google Tasks.
export async function completePersonalTask(listId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const url = feedUrl();
  if (!url) return { ok: false, error: 'No PERSONAL_TASKS_URL configured.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    // Apps Script runs doPost, then answers 302 with the output at a one-time echo URL. That URL is fetched with a
    // plain GET here: letting fetch follow the redirect itself sometimes gets a 404 from the echo URL.
    const posted = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'complete', listId, id }),
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    const location = posted.headers.get('location');
    const res = location ? await fetch(location, { cache: 'no-store', signal: controller.signal }) : posted;
    const text = await res.text();
    let data: { ok?: boolean; error?: string };
    try { data = JSON.parse(text); } catch { return { ok: false, error: 'The tasks script did not return JSON (is the updated version deployed?).' }; }
    return data.ok ? { ok: true } : { ok: false, error: data.error || 'The tasks script refused the request.' };
  } catch (err) {
    return { ok: false, error: (err as { name?: string })?.name === 'AbortError' ? 'The tasks script timed out.' : 'The tasks script is unreachable.' };
  } finally {
    clearTimeout(timer);
  }
}

export interface PersonalTasksResult {
  events: EventItem[];
  errors: string[];
  configured: boolean;
}

// Same window as the personal calendars: a short look-back plus about six months ahead.
export async function fetchPersonalTasks(): Promise<PersonalTasksResult> {
  const url = feedUrl();
  if (!url) return { events: [], errors: [], configured: false };

  const today = new Date();
  const fromDay = new Date(today.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const toDay = new Date(today.getTime() + 180 * 86400000).toISOString().slice(0, 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    // Apps Script answers with a redirect to script.googleusercontent.com, which fetch follows.
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`Google Tasks: HTTP ${res.status}`);
    const text = await res.text();
    let data: { tasks?: FeedTask[] };
    // A deployment that isn't shared as "Anyone" returns a Google sign-in page instead of JSON.
    try { data = JSON.parse(text); } catch { throw new Error('Google Tasks: the feed did not return JSON (check the web app is deployed with access "Anyone")'); }
    const events: EventItem[] = [];
    for (const task of data.tasks ?? []) {
      // The API stores only a due *date* (the time part is always midnight UTC), so it becomes an all-day item.
      const day = task.due?.slice(0, 10);
      if (!day || day < fromDay || day > toDay) continue;
      events.push({
        eventName: task.title?.trim() || 'Untitled task',
        start: day,
        venue: '',
        category: 'Personal',
        group: 'Tasks',
        price: '',
        rsvp: '',
        urgency: '',
        disposition: '',
        sourceUrl: task.webViewLink || undefined,
        source: 'personal',
        // Older script versions don't send ids; those tasks just show without a "Done" button.
        task: task.id && task.listId ? { id: task.id, listId: task.listId } : undefined,
      });
    }
    return { events, errors: [], configured: true };
  } catch (err) {
    const message = (err as { name?: string })?.name === 'AbortError' ? 'Google Tasks: feed timed out' : err instanceof Error ? err.message : String(err);
    return { events: [], errors: [message], configured: true };
  } finally {
    clearTimeout(timer);
  }
}
