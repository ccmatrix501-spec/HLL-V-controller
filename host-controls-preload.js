const fs = require('fs');
const path = require('path');
const express = require('express');

const HOST_STATIC_MARK = Symbol.for('1stmi.host-controls.static');
const originalStatic = express.static;
const originalUse = express.application.use;
let installed = false;

function parseJsonEnv(name, fallback = {}) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  } catch (err) {
    console.warn(`${name} is not valid JSON: ${err.message}`);
    return fallback;
  }
}

function actionConfig(action) {
  const upper = action.toUpperCase();
  return {
    url: String(process.env[`QPANEL_${upper}_URL`] || '').trim(),
    method: String(process.env[`QPANEL_${upper}_METHOD`] || 'POST').trim().toUpperCase(),
    body: parseJsonEnv(`QPANEL_${upper}_BODY_JSON`, null)
  };
}

function allowedQpanelUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:') return null;

  const configured = String(process.env.QPANEL_ALLOWED_HOSTS || 'qp.qonzer.com')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
  const host = url.hostname.toLowerCase();
  if (!configured.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) return null;
  return url;
}

function requireControllerAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: 'Controller login required' });
}

async function runQpanelAction(action) {
  const config = actionConfig(action);
  if (!config.url) {
    const err = new Error(`Qonzer ${action} control is not configured yet.`);
    err.statusCode = 503;
    throw err;
  }

  const url = allowedQpanelUrl(config.url);
  if (!url) {
    const err = new Error(`QPANEL_${action.toUpperCase()}_URL must be an HTTPS Qonzer/qPanel URL.`);
    err.statusCode = 500;
    throw err;
  }

  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': '1st-MI-HLLV-Controller/1.0',
    ...parseJsonEnv('QPANEL_CONTROL_HEADERS_JSON', {})
  };

  const bearer = String(process.env.QPANEL_CONTROL_BEARER_TOKEN || '').trim();
  const cookie = String(process.env.QPANEL_CONTROL_COOKIE || '').trim();
  if (bearer && !headers.Authorization && !headers.authorization) headers.Authorization = `Bearer ${bearer}`;
  if (cookie && !headers.Cookie && !headers.cookie) headers.Cookie = cookie;

  const options = {
    method: config.method,
    headers,
    redirect: 'manual'
  };

  if (!['GET', 'HEAD'].includes(config.method)) {
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
    options.body = JSON.stringify(config.body || {});
  }

  const response = await fetch(url, options);
  const text = await response.text();

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') || '';
    const err = new Error(`qPanel redirected the ${action} request${location ? ` to ${location}` : ''}. The qPanel authentication/session details likely need updating.`);
    err.statusCode = 502;
    throw err;
  }

  if (!response.ok) {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 500);
    const err = new Error(`qPanel ${action} request failed with HTTP ${response.status}${clean ? `: ${clean}` : ''}`);
    err.statusCode = 502;
    throw err;
  }

  return {
    ok: true,
    action,
    provider: 'Qonzer qPanel',
    http_status: response.status,
    response: text.slice(0, 1000)
  };
}

function injectHostControlsHtml(html) {
  if (!html.includes('/host-controls.js')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/host-controls.css" />\n</head>');
    html = html.replace('</body>', '  <script src="/host-controls.js" defer></script>\n</body>');
  }
  return html;
}

function installHostControls(app) {
  const qpanelUrl = process.env.QPANEL_URL || 'https://qp.qonzer.com/';

  app.get('/controller/host-control/status', requireControllerAuth, (req, res) => {
    const restart = actionConfig('restart');
    const stop = actionConfig('stop');
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      provider: 'Qonzer qPanel',
      qpanel_url: qpanelUrl,
      restart_configured: Boolean(restart.url),
      stop_configured: Boolean(stop.url)
    });
  });

  app.post('/controller/host-control/restart', requireControllerAuth, async (req, res) => {
    if (String(req.body?.confirm || '').toUpperCase() !== 'RESTART') {
      return res.status(400).json({ error: 'Type RESTART to confirm a server restart.' });
    }
    try {
      const result = await runQpanelAction('restart');
      console.warn(`HOST CONTROL: restart requested from controller at ${new Date().toISOString()}`);
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || String(err) });
    }
  });

  app.post('/controller/host-control/stop', requireControllerAuth, async (req, res) => {
    if (String(req.body?.confirm || '').toUpperCase() !== 'STOP') {
      return res.status(400).json({ error: 'Type STOP to confirm stopping the server.' });
    }
    try {
      const result = await runQpanelAction('stop');
      console.warn(`HOST CONTROL: stop requested from controller at ${new Date().toISOString()}`);
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || String(err) });
    }
  });

  const indexPath = path.join(process.cwd(), 'public', 'index.html');
  app.get(['/', '/index.html'], (req, res, next) => {
    try {
      const html = injectHostControlsHtml(fs.readFileSync(indexPath, 'utf8'));
      res.set('Cache-Control', 'no-store');
      res.type('html').send(html);
    } catch (err) {
      next(err);
    }
  });

  // The SPA fallback in server.js uses res.sendFile(index.html). Wrap it so direct
  // navigation to a client-side route also receives the Host Controls assets.
  app.use((req, res, next) => {
    const originalSendFile = res.sendFile.bind(res);
    res.sendFile = function(filePath, ...args) {
      if (path.basename(String(filePath)) === 'index.html') {
        try {
          const html = injectHostControlsHtml(fs.readFileSync(filePath, 'utf8'));
          res.set('Cache-Control', 'no-store');
          return res.type('html').send(html);
        } catch {}
      }
      return originalSendFile(filePath, ...args);
    };
    next();
  });

  console.log(`Qonzer host controls loaded: restart=${Boolean(actionConfig('restart').url)} stop=${Boolean(actionConfig('stop').url)}`);
}

express.static = function(...args) {
  const middleware = originalStatic.apply(this, args);
  middleware[HOST_STATIC_MARK] = true;
  return middleware;
};

express.application.use = function(...args) {
  if (!installed && args.some(arg => arg && arg[HOST_STATIC_MARK])) {
    installed = true;
    installHostControls(this);
  }
  return originalUse.apply(this, args);
};
