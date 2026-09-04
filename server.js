const crypto = require('crypto');
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

// Intentionally disabled. The controller must never abort a valid HLL:V RCON
// operation merely because it took longer than an arbitrary web timeout.
const RCON_PROXY_TIMEOUT_MS = 0;

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
    deployment: IS_RAILWAY ? 'railway' : 'local'
  });
});

app.get('/controller/health', (req, res) => {
  res.json({ ok: true, service: '1stmi-hll-controller' });
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
});

// Do not apply Node's request-duration timeout to RCON proxy operations.
server.requestTimeout = 0;

function shutdown(signal) {
  console.log(`${signal} received. Closing HTTP server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
