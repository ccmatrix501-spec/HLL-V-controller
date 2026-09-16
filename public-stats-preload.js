'use strict';

/**
 * Installs a small read-only public stats surface before the controller's normal
 * authenticated RCON middleware is registered. The private RCON bridge remains
 * private; only the explicitly sanitised player-stat fields below are exposed.
 */

const expressPath = require.resolve('express');
const realExpress = require('express');
const { rateLimit } = require('express-rate-limit');

const IS_RAILWAY = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID);
const RCON_BACKEND = process.env.RCON_BACKEND || (IS_RAILWAY
  ? 'http://hllv-rcon.railway.internal:8080'
  : 'http://hllv-rcon:8080');
const CACHE_MS = Math.max(5_000, Number(process.env.PUBLIC_STATS_CACHE_MS || 15_000));
const MAX_PUBLIC_PLAYERS = 10000;

let cache = {
  expiresAt: 0,
  payload: null,
};

const statsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many stats requests. Try again in a moment.' },
});

const liveStatsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many live stats requests. Try again in a moment.' },
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function text(value, max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function favourite(value) {
  if (!value || typeof value !== 'object') return null;
  const name = text(value.name, 180);
  if (!name) return null;
  return {
    id: text(value.id, 180),
    name,
    kills: number(value.kills),
  };
}

function publicPlayer(value) {
  if (!value || typeof value !== 'object') return null;
  const playerId = text(value.player_id, 180);
  const playerName = text(value.player_name, 180);
  if (!playerId || !playerName) return null;
  return {
    player_id: playerId,
    player_name: playerName,
    kills: number(value.kills),
    deaths: number(value.deaths),
    revives: number(value.revives),
    first_seen: text(value.first_seen, 80) || null,
    last_seen: text(value.last_seen, 80) || null,
    favorite_weapon: favourite(value.favorite_weapon),
    favorite_vehicle: favourite(value.favorite_vehicle),
  };
}

async function getJson(endpoint) {
  const response = await fetch(`${RCON_BACKEND}${endpoint}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': '1st-MI-Public-Stats/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = null; }
  if (!response.ok) {
    const detail = data?.error || data?.detail || `${response.status} ${response.statusText}`;
    throw new Error(String(detail));
  }
  return data;
}

async function statsPayload() {
  const now = Date.now();
  if (cache.payload && cache.expiresAt > now) return cache.payload;

  const [stats, status] = await Promise.all([
    getJson(`/api/v2/public-player-stats?limit=${MAX_PUBLIC_PLAYERS}`),
    getJson('/api/v2/player-stats/status'),
  ]);

  const players = Array.isArray(stats?.players)
    ? stats.players.map(publicPlayer).filter(Boolean)
    : [];

  const payload = {
    game: 'Hell Let Loose: Vietnam',
    tracked_players: number(status?.tracked_players) || number(stats?.tracked_players) || players.length,
    last_poll_at: text(status?.last_poll_at, 80) || null,
    updated_at: new Date().toISOString(),
    players,
  };

  cache = {
    expiresAt: now + CACHE_MS,
    payload,
  };
  return payload;
}

function installPublicStats(app) {
  // These endpoints intentionally contain public, sanitised game statistics only.
  // Allow the public website to read them directly so live polling does not need
  // to pass through a Vercel server function.
  app.use('/public/stats/hllv', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Accept, Content-Type');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  app.get('/public/stats/hllv', statsLimiter, async (req, res) => {
    try {
      const requested = Number(req.query?.limit ?? MAX_PUBLIC_PLAYERS);
      const limit = Number.isFinite(requested)
        ? Math.max(1, Math.min(MAX_PUBLIC_PLAYERS, Math.floor(requested)))
        : MAX_PUBLIC_PLAYERS;
      const payload = await statsPayload();
      res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
      res.set('X-Content-Type-Options', 'nosniff');
      return res.json({ ...payload, players: payload.players.slice(0, limit) });
    } catch (error) {
      console.warn(`Public HLL:V stats unavailable: ${error?.message || error}`);
      return res.status(502).json({
        error: 'HLL:V player statistics are temporarily unavailable.',
      });
    }
  });

  app.get('/public/stats/hllv/live', liveStatsLimiter, async (req, res) => {
    try {
      const live = await getJson('/api/v2/public-player-stats-live?active_seconds=20&limit=500');
      const players = Array.isArray(live?.players)
        ? live.players.map(publicPlayer).filter(Boolean)
        : [];
      res.set('Cache-Control', 'no-store, max-age=0');
      res.set('X-Content-Type-Options', 'nosniff');
      return res.json({
        game: 'Hell Let Loose: Vietnam',
        updated_at: text(live?.updated_at, 80) || new Date().toISOString(),
        active_players: number(live?.active_players) || players.length,
        players,
      });
    } catch (error) {
      console.warn(`Public HLL:V live stats unavailable: ${error?.message || error}`);
      return res.status(502).json({
        error: 'HLL:V live statistics are temporarily unavailable.',
      });
    }
  });
}

const wrappedExpress = new Proxy(realExpress, {
  apply(target, thisArg, args) {
    const app = Reflect.apply(target, thisArg, args);
    installPublicStats(app);
    return app;
  },
});

require.cache[expressPath].exports = wrappedExpress;
