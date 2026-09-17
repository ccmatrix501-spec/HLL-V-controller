'use strict';

const BACKEND = String(process.env.RCON_BACKEND || '').replace(/\/$/, '');
const CHECK_MS = Math.max(5000, Number(process.env.RCON_WATCHDOG_INTERVAL_MS || 15000));
const TIMEOUT_MS = Math.max(2000, Number(process.env.RCON_WATCHDOG_TIMEOUT_MS || 8000));

let lastState = '';

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND}${path}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function check() {
  if (!BACKEND) {
    const state = 'misconfigured';
    if (state !== lastState) {
      console.error('[RCON-WATCHDOG] RCON_BACKEND is not configured');
      lastState = state;
    }
    return;
  }

  try {
    await fetchJson('/health');
    const status = await fetchJson('/api/v2/connection/status');
    const connected = Boolean(status && status.connected);
    const state = connected ? 'healthy-connected' : 'healthy-disconnected';
    if (state !== lastState) {
      const log = connected ? console.log : console.warn;
      log(`[RCON-WATCHDOG] backend healthy; game RCON ${connected ? 'CONNECTED' : 'DISCONNECTED'} (${BACKEND})`);
      lastState = state;
    }
  } catch (error) {
    const state = 'backend-unreachable';
    if (state !== lastState) {
      console.error(`[RCON-WATCHDOG] backend unreachable (${BACKEND}): ${error?.message || error}`);
      lastState = state;
    }
  }
}

setTimeout(() => {
  void check();
  const timer = setInterval(() => void check(), CHECK_MS);
  timer.unref?.();
}, 1500).unref?.();
