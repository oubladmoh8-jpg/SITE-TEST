'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;
const rateLimit = require('express-rate-limit');

const { db, statements, initializeOwner, findOrCreateOAuthUser } = require('./database');
const { router: authRouter, safePublicUser } = require('./routes/auth');
const { requireAuth, requireOwner } = require('./middleware/auth');
const ownerRouter = require('./routes/owner');
const downloadRouter = require('./routes/downloads');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const port = Number.parseInt(process.env.PORT || '3000', 10);
const viewsDir = path.resolve(__dirname, 'views');
const publicDir = path.resolve(__dirname, 'public');
const SQLiteStore = SQLiteStoreFactory(session);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret === 'CHANGE_ME' || sessionSecret.length < 32) {
  if (isProduction) throw new Error('Set SESSION_SECRET to a random value of at least 32 characters in production.');
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn('SESSION_SECRET is not configured; using a temporary development-only secret. Set it in .env to keep sessions across restarts.');
}

for (const directory of [
  path.resolve(__dirname, 'database'),
  path.resolve(__dirname, 'uploads/projects'),
  path.resolve(__dirname, 'uploads/images'),
]) {
  fs.mkdirSync(directory, { recursive: true });
}

initializeOwner();

const oauthEnabled = {
  google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
};
app.locals.oauthEnabled = oauthEnabled;

function oauthVerify(provider) {
  return (accessToken, refreshToken, profile, done) => {
    try {
      const emailRecord = Array.isArray(profile.emails) ? profile.emails.find((item) => item && item.value) : null;
      const emailVerified = provider === 'google'
        ? Boolean(profile._json && profile._json.email_verified)
        : Boolean(profile.verified);
      if (!emailRecord || !emailVerified) {
        return done(null, false, { message: 'A verified email address is required for OAuth login.' });
      }
      const user = findOrCreateOAuthUser(
        provider,
        String(profile.id),
        emailRecord.value,
        profile.username || profile.displayName,
      );
      return done(null, user);
    } catch (error) {
      // Authentication details are intentionally not exposed to the browser.
      console.warn(`OAuth sign-in rejected for provider ${provider}.`);
      return done(null, false, { message: 'OAuth sign-in could not be completed.' });
    }
  };
}

if (oauthEnabled.google) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
    state: true,
  }, oauthVerify('google')));
} else {
  console.info('Google OAuth is disabled until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured.');
}

if (oauthEnabled.discord) {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
    scope: ['identify', 'email'],
    state: true,
  }, oauthVerify('discord')));
} else {
  console.info('Discord OAuth is disabled until DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are configured.');
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  try {
    const user = statements.findUserById.get(id);
    if (!user || !user.is_active) return done(null, false);
    return done(null, user);
  } catch (error) {
    return done(error);
  }
});

app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
    },
  },
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(express.urlencoded({ extended: false, limit: '30kb' }));
app.use(express.json({ limit: '30kb' }));
app.use(express.static(publicDir, { index: false, dotfiles: 'deny', fallthrough: true }));

app.use(session({
  name: 'c8b.sid',
  secret: sessionSecret,
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: path.resolve(__dirname, 'database'),
    table: 'sessions',
    concurrentDB: true,
  }),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8,
    path: '/',
  },
}));

app.use(passport.initialize());
app.use(passport.session());

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});
app.use('/api', generalLimiter);

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', app: 'C8B' }));

app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/app');
  return res.redirect('/login');
});
app.get('/login', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/app');
  return res.sendFile(path.join(viewsDir, 'login.html'));
});
app.get('/register', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/app');
  return res.sendFile(path.join(viewsDir, 'register.html'));
});

app.use('/api/auth', authRouter);
app.use('/auth', authRouter);

app.get('/app', requireAuth, (req, res) => {
  if (req.user.role === 'owner') return res.redirect('/owner');
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(viewsDir, 'authenticated.html'));
});

// Owner UI and all management APIs are protected on the server, independently of the frontend.
app.get('/owner', requireAuth, requireOwner, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(viewsDir, 'owner.html'));
});
app.use('/api/owner', ownerRouter);
app.use('/api/download', downloadRouter);

// Every unknown request returns a generic message; internal errors are never serialized.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  return res.status(404).send('404 — Page not found');
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Request failed:', error && error.message ? error.message : 'unknown error');
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: isProduction ? 'An unexpected error occurred.' : 'Request failed. Check the server logs.' });
  }
  return res.status(500).send(isProduction ? 'An unexpected error occurred.' : 'Request failed. Check the server logs.');
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`C8B server listening on port ${port}`);
});

function shutdown() {
  server.close(() => {
    try { db.close(); } finally { process.exit(0); }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
