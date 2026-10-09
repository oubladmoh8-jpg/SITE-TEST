-- C8B file-based database schema (SQLite).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL COLLATE NOCASE UNIQUE,
 email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 password_hash TEXT NULL,
 role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','owner')),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
 description TEXT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 slug TEXT NOT NULL COLLATE BINARY UNIQUE,
 description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 version TEXT NOT NULL DEFAULT '1.0.0',
 featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
 icon_path TEXT NULL,
 banner_path TEXT NULL,
 screenshots_json TEXT NOT NULL DEFAULT '[]',
 features_json TEXT NOT NULL DEFAULT '[]',
 requirements TEXT NOT NULL DEFAULT '',
 changelog TEXT NOT NULL DEFAULT '',
 external_links_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_category_id ON projects(category_id);
CREATE INDEX IF NOT EXISTS idx_projects_status_created ON projects(status, created_at);
CREATE INDEX IF NOT EXISTS idx_projects_featured ON projects(featured, created_at);

CREATE TABLE IF NOT EXISTS project_files (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 original_name TEXT NOT NULL,
 stored_name TEXT NOT NULL COLLATE BINARY UNIQUE,
 mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 version TEXT NOT NULL DEFAULT '1.0.0',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive'))
);
CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_project_files_status ON project_files(status, created_at);

CREATE TABLE IF NOT EXISTS downloads (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_file_id INTEGER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
 user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
 downloaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_downloads_file_id ON downloads(project_file_id);
CREATE INDEX IF NOT EXISTS idx_downloads_user_id ON downloads(user_id);
CREATE INDEX IF NOT EXISTS idx_downloads_date ON downloads(downloaded_at);

CREATE TABLE IF NOT EXISTS oauth_accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL COLLATE BINARY CHECK(provider IN ('google','discord')),
 provider_user_id TEXT NOT NULL COLLATE BINARY,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(provider, provider_user_id),
 UNIQUE(user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);

CREATE TABLE IF NOT EXISTS site_settings (
 "key" TEXT PRIMARY KEY COLLATE BINARY,
 "value" TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contact_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL,
 subject TEXT NOT NULL,
 message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','read','closed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at);

INSERT OR IGNORE INTO site_settings ("key","value") VALUES
 ('site_name','C8B'),
 ('site_description','Build. Create. Share.'),
 ('default_project_status','draft'),
 ('upload_max_mb','100');
