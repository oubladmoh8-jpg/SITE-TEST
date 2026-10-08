'use strict';

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const configuredPath = process.env.DATABASE_PATH || './database/database.sqlite';
const databasePath = path.resolve(process.cwd(), configuredPath);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'owner')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS project_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_file_id INTEGER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    downloaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS oauth_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'discord')),
    provider_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (provider, provider_user_id),
    UNIQUE (user_id, provider)
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
  CREATE INDEX IF NOT EXISTS idx_projects_category_id ON projects(category_id);
  CREATE INDEX IF NOT EXISTS idx_projects_status_created ON projects(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
  CREATE INDEX IF NOT EXISTS idx_downloads_file_id ON downloads(project_file_id);
  CREATE INDEX IF NOT EXISTS idx_downloads_user_id ON downloads(user_id);
  CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);
`);

const statements = {
  findUserById: db.prepare('SELECT id, username, email, password_hash, role, is_active, created_at FROM users WHERE id = ?'),
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE'),
  insertUser: db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'),
  findOAuthAccount: db.prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?'),
  insertOAuthAccount: db.prepare('INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)'),
};

function initializeOwner() {
  const username = String(process.env.OWNER_USERNAME || 'admin').trim();
  const hash = String(process.env.OWNER_PASSWORD_HASH || '').trim();

  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    throw new Error('OWNER_USERNAME must be 3–24 characters using letters, numbers, or underscores.');
  }

  // A real bcrypt hash must be configured explicitly. Never seed an insecure default password.
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) {
    console.warn('Owner account not seeded: set OWNER_PASSWORD_HASH to a bcrypt hash in your local .env.');
    return;
  }

  const existing = statements.findUserByUsername.get(username);
  if (existing && existing.role !== 'owner') {
    throw new Error('The configured owner username already belongs to a normal user. Resolve the username conflict before startup.');
  }

  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, is_active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(hash, existing.id);
    return;
  }

  const ownerEmail = (process.env.OWNER_EMAIL || 'admin@localhost.invalid').trim().toLowerCase();
  const emailOwner = statements.findUserByEmail.get(ownerEmail);
  if (emailOwner) {
    throw new Error('OWNER_EMAIL is already used by another account. Configure a unique OWNER_EMAIL.');
  }

  statements.insertUser.run(username, ownerEmail, hash, 'owner');
}

function findOrCreateOAuthUser(provider, providerUserId, email, displayName) {
  const existingAccount = statements.findOAuthAccount.get(provider, providerUserId);
  if (existingAccount) {
    const linkedUser = statements.findUserById.get(existingAccount.user_id);
    if (!linkedUser || !linkedUser.is_active) throw new Error('This account is unavailable.');
    return linkedUser;
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 254) {
    throw new Error('The provider did not supply a usable verified email address.');
  }

  // Do not silently link OAuth to a password account based only on matching email.
  if (statements.findUserByEmail.get(normalizedEmail)) {
    throw new Error('An account with this email already exists. Sign in with your password first; automatic account linking is disabled.');
  }

  const base = String(displayName || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 12);
  const username = `oauth_${base || 'user'}_${require('node:crypto').randomBytes(4).toString('hex')}`.slice(0, 24);
  const createLinkedAccount = db.transaction(() => {
    const result = statements.insertUser.run(username, normalizedEmail, null, 'user');
    statements.insertOAuthAccount.run(Number(result.lastInsertRowid), provider, String(providerUserId));
    return statements.findUserById.get(Number(result.lastInsertRowid));
  });

  return createLinkedAccount();
}

module.exports = { db, statements, initializeOwner, findOrCreateOAuthUser, databasePath };
