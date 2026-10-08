'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const { statements, findOrCreateOAuthUser } = require('../database');
const { requireAuth, csrfToken, requireCsrf } = require('../middleware/auth');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait and try again.' },
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
});

function cleanString(value, maxLength = 254) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password) {
  if (typeof password !== 'string') return false;
  const bytes = Buffer.byteLength(password, 'utf8');
  return password.length >= 12 && password.length <= 128 && bytes <= 72 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

function safePublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
  };
}

function sendAuthError(res, status, message) {
  return res.status(status).json({ error: message });
}

router.get('/csrf', csrfToken);

router.post('/register', registrationLimiter, requireCsrf, async (req, res, next) => {
  try {
    const username = cleanString(req.body && req.body.username, 24);
    const email = cleanString(req.body && req.body.email).toLowerCase();
    const password = req.body && req.body.password;
    const confirmPassword = req.body && req.body.confirmPassword;

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      return sendAuthError(res, 400, 'Username must be 3–24 characters and use only letters, numbers, or underscores.');
    }
    if (!validEmail(email)) return sendAuthError(res, 400, 'Enter a valid email address.');
    if (!validPassword(password)) {
      return sendAuthError(res, 400, 'Password must be 12–128 characters and include lowercase, uppercase, and a number. Passwords may use at most 72 UTF-8 bytes.');
    }
    if (password !== confirmPassword) return sendAuthError(res, 400, 'Passwords do not match.');

    const ownerUsername = String(process.env.OWNER_USERNAME || 'admin').trim().toLowerCase();
    if (username.toLowerCase() === ownerUsername) {
      return sendAuthError(res, 400, 'That username is reserved.');
    }
    const reservedOwnerEmail = cleanString(process.env.OWNER_EMAIL || 'admin@localhost.invalid').toLowerCase();
    if (email === reservedOwnerEmail) {
      return sendAuthError(res, 400, 'That email address is reserved.');
    }
    if (statements.findUserByUsername.get(username)) return sendAuthError(res, 409, 'That username is already in use.');
    if (statements.findUserByEmail.get(email)) return sendAuthError(res, 409, 'An account with that email already exists.');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = statements.insertUser.run(username, email, passwordHash, 'user');
    const user = statements.findUserById.get(Number(result.lastInsertRowid));

    req.login(user, (err) => {
      if (err) return next(err);
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        return res.status(201).json({ user: safePublicUser(user), redirect: '/app' });
      });
    });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return sendAuthError(res, 409, 'That username or email is already in use.');
    }
    return next(error);
  }
});

router.post('/login', authLimiter, requireCsrf, async (req, res, next) => {
  try {
    const identifier = cleanString(req.body && req.body.identifier, 254);
    const password = req.body && req.body.password;
    if (!identifier || typeof password !== 'string' || password.length > 128 || Buffer.byteLength(password, 'utf8') > 72) {
      return sendAuthError(res, 400, 'Enter your username or email and a valid password.');
    }

    const user = identifier.includes('@')
      ? statements.findUserByEmail.get(identifier.toLowerCase())
      : statements.findUserByUsername.get(identifier);
    const passwordHash = user && user.password_hash;
    const passwordMatches = passwordHash
      ? await bcrypt.compare(password, passwordHash)
      : await bcrypt.compare(password, '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5kqR0xY2nYw8gK8l8pV1N6m8V3s9x5u');
    if (!user || !user.is_active || !passwordHash || !passwordMatches) {
      return sendAuthError(res, 401, 'Invalid username/email or password.');
    }

    req.login(user, (err) => {
      if (err) return next(err);
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        return res.json({ user: safePublicUser(user), redirect: '/app' });
      });
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', requireCsrf, (req, res, next) => {
  req.logout((logoutError) => {
    if (logoutError) return next(logoutError);
    req.session.destroy((sessionError) => {
      if (sessionError) return next(sessionError);
      res.clearCookie('c8b.sid', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      });
      return res.json({ redirect: '/login' });
    });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ user: safePublicUser(req.user) });
});

router.get('/google', authLimiter, (req, res, next) => {
  if (!req.app.locals.oauthEnabled.google) return res.redirect('/login?error=oauth_unavailable');
  return passport.authenticate('google', { scope: ['profile', 'email'], state: true })(req, res, next);
});

router.get('/google/callback', authLimiter, (req, res, next) => {
  if (!req.app.locals.oauthEnabled.google) return res.redirect('/login?error=oauth_unavailable');
  return passport.authenticate('google', { failureRedirect: '/login?error=oauth_failed' })(req, res, next);
}, (req, res) => res.redirect('/app'));

router.get('/discord', authLimiter, (req, res, next) => {
  if (!req.app.locals.oauthEnabled.discord) return res.redirect('/login?error=oauth_unavailable');
  return passport.authenticate('discord', { scope: ['identify', 'email'], state: true })(req, res, next);
});

router.get('/discord/callback', authLimiter, (req, res, next) => {
  if (!req.app.locals.oauthEnabled.discord) return res.redirect('/login?error=oauth_failed');
  return passport.authenticate('discord', { failureRedirect: '/login?error=oauth_failed' })(req, res, next);
}, (req, res) => res.redirect('/app'));

module.exports = { router, safePublicUser, validEmail, validPassword, cleanString };
