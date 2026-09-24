// Yesterday's Colorado Rockies result, for the food deals that only run the day after a qualifying game (Taco Bell's
// 7+ runs tacos, Jet's stolen-base slice). Reads MLB's public Stats API, so it needs no key and works on any host.
// "Yesterday" is the Denver calendar day; a doubleheader qualifies if either game does.
import { reply } from '../../dismissApi';

export const dynamic = 'force-dynamic';

const ROCKIES = 115;
const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; date: string; body: Record<string, unknown> } | null = null;

interface ScheduleGame { gamePk: number; gameType: string; status?: { abstractGameState?: string }; teams: { home: { team: { id: number } } } }

export async function GET(): Promise<Response> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const date = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (cache && cache.date === date && Date.now() - cache.at < TTL_MS) return reply(200, cache.body);
  try {
    const schedule = await (await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${ROCKIES}&date=${date}`, { cache: 'no-store' })).json() as { dates?: Array<{ games: ScheduleGame[] }> };
    const finals = (schedule.dates ?? []).flatMap((d) => d.games).filter((g) => g.gameType === 'R' && g.status?.abstractGameState === 'Final');
    const games = await Promise.all(finals.map(async (g) => {
      const side = g.teams.home.team.id === ROCKIES ? 'home' : 'away';
      const box = await (await fetch(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`, { cache: 'no-store' })).json() as { teams: Record<'home' | 'away', { teamStats: { batting: { runs?: number; stolenBases?: number } } }> };
      const batting = box.teams[side].teamStats.batting;
      return { runs: batting.runs ?? 0, stolenBases: batting.stolenBases ?? 0 };
    }));
    const body = { ok: true, date, games, sevenPlusRuns: games.some((g) => g.runs >= 7), stoleBase: games.some((g) => g.stolenBases > 0) };
    cache = { at: Date.now(), date, body };
    return reply(200, body);
  } catch (err) {
    return reply(502, { ok: false, error: `MLB Stats API unavailable (${err instanceof Error ? err.message : 'unknown error'})` });
  }
}
