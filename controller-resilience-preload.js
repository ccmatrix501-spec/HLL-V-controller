'use strict';

// Loaded before server.js. This keeps the controller UI responsive even when the
// RCON bridge is temporarily unavailable, without changing the bridge's own
// persistent RCON/TCP connection behaviour.

const express = require('express');
const hpm = require('http-proxy-middleware');

const CONTROLLER_PROXY_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.CONTROLLER_PROXY_TIMEOUT_MS || 30000)
);

// server.js intentionally set the proxy timeout to 0 in an earlier revision.
// Zero means a dead/unreachable backend request can remain open indefinitely.
// Wrap the proxy factory so the controller HTTP request fails cleanly instead of
// leaving the browser loading forever. This does NOT disconnect the RCON session
// held by hllv-rcon and does not disable its automatic reconnect worker.
const originalCreateProxyMiddleware = hpm.createProxyMiddleware;
hpm.createProxyMiddleware = function resilientCreateProxyMiddleware(options = {}) {
  return originalCreateProxyMiddleware({
    ...options,
    timeout: CONTROLLER_PROXY_TIMEOUT_MS,
    proxyTimeout: CONTROLLER_PROXY_TIMEOUT_MS
  });
};

// The controller changes frequently. Railway was previously serving JS/CSS with
// a one-hour max-age, which could mix old scripts with a newly deployed backend.
// Force controller static assets to revalidate immediately after every deploy.
const originalStatic = express.static;
express.static = function freshControllerStatic(root, options = {}) {
  const originalSetHeaders = options.setHeaders;
  return originalStatic(root, {
    ...options,
    maxAge: 0,
    etag: false,
    lastModified: false,
    setHeaders(res, filePath, stat) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      if (typeof originalSetHeaders === 'function') {
        originalSetHeaders(res, filePath, stat);
      }
    }
  });
};

console.log(`Controller resilience enabled (HTTP proxy timeout ${CONTROLLER_PROXY_TIMEOUT_MS}ms; static cache disabled).`);
