const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const { rateLimit } = require('express-rate-limit');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');

const IS_RAILWAY = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID);
const PORT = Number(process.env.PORT || 8090);
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const RCON_BACKEND = process.env.RCON_BACKEND || (IS_RAILWAY
  ? 'http://hllv-rcon.railway.internal:8080'
  : 'http://hllv-rcon:8080');
const QPANEL_URL = process.env.QPANEL_URL || 'https://qp.qonzer.com/';
const TRUST_PROXY = process.env.TRUST_PROXY !== undefined
  ? process.env.TRUST_PROXY === 'true'
  : IS_RAILWAY;
const COOKIE_SECURE = process.env.COOKIE_SECURE !== undefined
  ? process.env.COOKIE_SECURE === 'true'
  : IS_RAILWAY;

// The controller does not impose an artificial timeout on valid RCON operations.
const RCON_PROXY_TIMEOUT_MS = 0;

// Repeat jobs run on the controller, not in the browser, so they continue when the
// controller page is closed. Set SCHEDULER_FILE to a Railway volume path such as
// /data/repeat-jobs.json if you want jobs to survive deployments/restarts too.
const SCHEDULER_FILE = process.env.SCHEDULER_FILE || '/tmp/1stmi-hllv-repeat-jobs.json';
const MIN_REPEAT_INTERVAL_SECONDS = Math.max(10, Number(process.env.MIN_REPEAT_INTERVAL_SECONDS || 30));
const MAX_REPEAT_INTERVAL_SECONDS = 7 * 24 * 60 * 60;
const MAX_REPEAT_JOBS = 100;

const HLLV_ALLOWED_MAPS = Object.freeze([
  'wdeva_offensivenva_day',
  'wdeva_offensiveus_day',
  'wdevb_offensivenva_day',
  'wdevb_offensiveus_day',
  'wdevc_offensivenva_day',
  'wdevc_offensiveus_day',
  'wdevd_offensivenva_day',
  'wdevd_offensiveus_day',
  'wdeve_offensivenva_day',
  'wdeve_offensiveus_day',
  'wdevf_offensivenva_day',
  'wdevf_offensiveus_day'
]);
const HLLV_ALLOWED_MAP_SET = new Set(HLLV_ALLOWED_MAPS);

if (!PANEL_PASSWORD || PANEL_PASSWORD.length < 10) {
  console.error('PANEL_PASSWORD must be set and at least 10 characters long.');
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set and at least 32 characters long.');
  process.exit(1);
}

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

app.use(express.json({ limit: '64kb' }));

app.use(session({
  name: 'mi_controller_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: TRUST_PROXY,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: COOKIE_SECURE,
    maxAge: 12 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' }
});

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: 'Controller login required' });
}

app.post('/controller/login', loginLimiter, (req, res) => {
  const password = req.body?.password || '';
  if (!safeEqual(password, PANEL_PASSWORD)) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.authenticated = true;
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: 'Session error' });
      res.json({ ok: true });
    });
  });
});

app.post('/controller/logout', (req, res) => {
  req.session?.destroy(() => {
    res.clearCookie('mi_controller_sid');
    res.json({ ok: true });
  });
});

app.get('/controller/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    authenticated: Boolean(req.session?.authenticated),
    qpanel_url: QPANEL_URL,
    deployment: IS_RAILWAY ? 'railway' : 'local',
    repeat_scheduler: true,
    min_repeat_interval_seconds: MIN_REPEAT_INTERVAL_SECONDS
  });
});

app.get('/controller/health', (req, res) => {
  res.json({ ok: true, service: '1stmi-hll-controller' });
});

// ---------- Repeat scheduler ----------
let repeatJobs = [];

function publicRepeatJob(job) {
  return {
    id: job.id,
    type: job.type,
    message: job.message,
    player_id: job.player_id || null,
    player_name: job.player_name || null,
    interval_seconds: job.interval_seconds,
    repeat_count: job.repeat_count,
    sent_count: job.sent_count,
    active: Boolean(job.active),
    running: Boolean(job.running),
    send_immediately: Boolean(job.send_immediately),
    created_at: job.created_at,
    last_sent_at: job.last_sent_at || null,
    next_run_at: job.next_run_at || null,
    last_error: job.last_error || null
  };
}

function persistRepeatJobs() {
  try {
    const dir = path.dirname(SCHEDULER_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const safeJobs = repeatJobs.map(job => ({ ...job, running: false }));
    const tmp = `${SCHEDULER_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(safeJobs, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, SCHEDULER_FILE);
  } catch (err) {
    console.warn(`Repeat scheduler persistence unavailable: ${err.message}`);
  }
}

function loadRepeatJobs() {
  try {
    if (!fs.existsSync(SCHEDULER_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(SCHEDULER_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    repeatJobs = parsed
      .filter(job => job && typeof job === 'object' && ['broadcast', 'player_message'].includes(job.type))
      .slice(0, MAX_REPEAT_JOBS)
      .map(job => ({
        ...job,
        running: false,
        active: Boolean(job.active),
        sent_count: Number(job.sent_count || 0),
        next_run_at: job.active
          ? (job.next_run_at && Date.parse(job.next_run_at) > now ? job.next_run_at : new Date(now + Number(job.interval_seconds || 60) * 1000).toISOString())
          : null
      }));
  } catch (err) {
    console.warn(`Could not load repeat scheduler file: ${err.message}`);
    repeatJobs = [];
  }
}

async function postDirectToRcon(endpoint, body) {
  const response = await fetch(`${RCON_BACKEND}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const detail = data?.error || data?.detail || text || `${response.status} ${response.statusText}`;
    throw new Error(String(detail));
  }
  return data;
}

async function executeRepeatJob(job) {
  if (!job.active || job.running) return;
  job.running = true;
  try {
    if (job.type === 'broadcast') {
      await postDirectToRcon('/api/v2/broadcast', { message: job.message });
    } else {
      await postDirectToRcon(`/api/v2/players/${encodeURIComponent(job.player_id)}/message`, { message: job.message });
    }

    job.sent_count += 1;
    job.last_sent_at = new Date().toISOString();
    job.last_error = null;

    if (job.repeat_count > 0 && job.sent_count >= job.repeat_count) {
      job.active = false;
      job.next_run_at = null;
    } else {
      job.next_run_at = new Date(Date.now() + job.interval_seconds * 1000).toISOString();
    }
  } catch (err) {
    job.last_error = err?.message || String(err);
    job.next_run_at = new Date(Date.now() + job.interval_seconds * 1000).toISOString();
    console.warn(`Repeat job ${job.id} failed: ${job.last_error}`);
  } finally {
    job.running = false;
    persistRepeatJobs();
  }
}

function processRepeatJobs() {
  const now = Date.now();
  const due = repeatJobs.filter(job => job.active && !job.running && job.next_run_at && Date.parse(job.next_run_at) <= now);
  // Fire each due job independently. Because RCON timeouts are intentionally disabled,
  // one unusually slow command must never freeze every other repeat timer.
  for (const job of due) {
    executeRepeatJob(job).catch(err => console.warn(`Repeat job worker failed: ${err?.message || err}`));
  }
}

loadRepeatJobs();
const repeatTicker = setInterval(processRepeatJobs, 1000);
repeatTicker.unref();

app.get('/controller/repeat-jobs', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    jobs: repeatJobs.map(publicRepeatJob),
    min_interval_seconds: MIN_REPEAT_INTERVAL_SECONDS,
    storage_file: SCHEDULER_FILE
  });
});

app.post('/controller/repeat-jobs', requireAuth, (req, res) => {
  if (repeatJobs.length >= MAX_REPEAT_JOBS) {
    return res.status(400).json({ error: `Maximum of ${MAX_REPEAT_JOBS} repeat jobs reached.` });
  }

  const type = String(req.body?.type || '').trim();
  const message = String(req.body?.message || '').trim();
  const playerId = String(req.body?.player_id || '').trim();
  const playerName = String(req.body?.player_name || '').trim();
  const intervalSeconds = Number(req.body?.interval_seconds);
  const repeatCount = Number(req.body?.repeat_count || 0);
  const sendImmediately = req.body?.send_immediately !== false;

  if (!['broadcast', 'player_message'].includes(type)) {
    return res.status(400).json({ error: 'type must be broadcast or player_message' });
  }
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (message.length > 500) return res.status(400).json({ error: 'message cannot exceed 500 characters' });
  if (type === 'player_message' && !playerId) return res.status(400).json({ error: 'player_id is required for player messages' });
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_REPEAT_INTERVAL_SECONDS || intervalSeconds > MAX_REPEAT_INTERVAL_SECONDS) {
    return res.status(400).json({ error: `interval_seconds must be between ${MIN_REPEAT_INTERVAL_SECONDS} and ${MAX_REPEAT_INTERVAL_SECONDS}` });
  }
  if (!Number.isInteger(repeatCount) || repeatCount < 0 || repeatCount > 10000) {
    return res.status(400).json({ error: 'repeat_count must be 0 (forever) or an integer from 1 to 10000' });
  }

  const now = new Date();
  const job = {
    id: crypto.randomUUID(),
    type,
    message,
    player_id: type === 'player_message' ? playerId : null,
    player_name: type === 'player_message' ? (playerName || playerId) : null,
    interval_seconds: Math.round(intervalSeconds),
    repeat_count: repeatCount,
    sent_count: 0,
    active: true,
    running: false,
    send_immediately: sendImmediately,
    created_at: now.toISOString(),
    last_sent_at: null,
    next_run_at: sendImmediately ? now.toISOString() : new Date(now.getTime() + intervalSeconds * 1000).toISOString(),
    last_error: null
  };

  repeatJobs.push(job);
  persistRepeatJobs();
  setImmediate(processRepeatJobs);
  return res.status(201).json({ ok: true, job: publicRepeatJob(job) });
});

app.post('/controller/repeat-jobs/:id/run-now', requireAuth, (req, res) => {
  const job = repeatJobs.find(item => item.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Repeat job not found' });
  if (!job.active) job.active = true;
  job.next_run_at = new Date().toISOString();
  persistRepeatJobs();
  setImmediate(processRepeatJobs);
  res.json({ ok: true, job: publicRepeatJob(job) });
});

app.delete('/controller/repeat-jobs/:id', requireAuth, (req, res) => {
  const index = repeatJobs.findIndex(item => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Repeat job not found' });
  repeatJobs.splice(index, 1);
  persistRepeatJobs();
  res.json({ ok: true });
});

app.delete('/controller/repeat-jobs', requireAuth, (req, res) => {
  repeatJobs = [];
  persistRepeatJobs();
  res.json({ ok: true });
});

// ---------- HLL:V map restrictions ----------
app.get('/api/v2/maps', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(HLLV_ALLOWED_MAPS);
});

app.post('/api/v2/change-map', requireAuth, (req, res, next) => {
  const requested = String(req.body?.map_name || '').trim().toLowerCase();
  if (!HLLV_ALLOWED_MAP_SET.has(requested)) {
    return res.status(400).json({
      error: 'Map is not in the configured HLL:V rotation.',
      allowed_maps: HLLV_ALLOWED_MAPS
    });
  }
  req.body.map_name = requested;
  next();
});

const rconProxy = createProxyMiddleware({
  target: RCON_BACKEND,
  changeOrigin: true,
  xfwd: true,
  proxyTimeout: RCON_PROXY_TIMEOUT_MS,
  timeout: RCON_PROXY_TIMEOUT_MS,
  on: {
    proxyReq: fixRequestBody,
    error(err, req, res) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({
        error: `RCON backend unavailable: ${err.message}`,
        hint: IS_RAILWAY
          ? 'Check RCON_BACKEND and confirm the hllv-rcon Railway service is online on port 8080.'
          : 'Check that the hllv-rcon service is running.'
      }));
    }
  }
});

app.use((req, res, next) => {
  const isRconRoute = req.path.startsWith('/api/') || req.path === '/version' || req.path === '/health';
  if (!isRconRoute) return next();
  requireAuth(req, res, () => rconProxy(req, res, next));
});

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  maxAge: IS_RAILWAY ? '1h' : 0
}));

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`1st M.I. HLL Server Controller listening on port ${PORT}`);
  console.log(`Deployment: ${IS_RAILWAY ? 'Railway' : 'local'}`);
  console.log(`RCON backend: ${RCON_BACKEND}`);
  console.log('RCON proxy timeout: disabled');
  console.log(`HLL:V map pool locked to ${HLLV_ALLOWED_MAPS.length} configured maps`);
  console.log(`Repeat scheduler active; minimum interval ${MIN_REPEAT_INTERVAL_SECONDS}s; ${repeatJobs.filter(j => j.active).length} active job(s)`);
  console.log(`Repeat scheduler file: ${SCHEDULER_FILE}`);
});

server.requestTimeout = 0;

function shutdown(signal) {
  console.log(`${signal} received. Saving repeat jobs and closing HTTP server...`);
  clearInterval(repeatTicker);
  persistRepeatJobs();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
