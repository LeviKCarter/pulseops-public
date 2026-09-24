// Identifies one event across feed refreshes, so a dismissal keeps matching it. A plain module (not the 'use client'
// UpcomingEvents) so server routes can call it too.
export const eventKey = (event: { eventName: string; start: string; venue: string }) =>
  `${event.eventName}|${event.start}|${event.venue}`.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240);
