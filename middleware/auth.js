'use strict';

const crypto = require('node:crypto');

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.is_active) {
    return next();
  }
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  return res.redirect('/login');
}

function requireOwner(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user || !req.user.is_active) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'You do not have permission to access this resource.' });
  }
  return next();
}

function csrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.set('Cache-Control', 'no-store');
  return res.json({ csrfToken: req.session.csrfToken });
}

function requireCsrf(req, res, next) {
  const supplied = req.get('x-csrf-token') || (req.body && req.body.csrfToken);
  const expected = req.session && req.session.csrfToken;
  if (typeof supplied !== 'string' || typeof expected !== 'string') {
    return res.status(403).json({ error: 'Request verification failed. Refresh the page and try again.' });
  }
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return res.status(403).json({ error: 'Request verification failed. Refresh the page and try again.' });
  }
  return next();
}

module.exports = { requireAuth, requireOwner, csrfToken, requireCsrf };
