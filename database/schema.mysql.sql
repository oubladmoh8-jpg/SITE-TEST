-- C8B PHP migration schema.
-- Target: MySQL 8.0.16+ (for enforced CHECK constraints and expression defaults).
-- No SQLite data is imported by this file; it creates the schema only.
-- Run this against a newly created, empty MySQL database.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
    id BIGINT NOT NULL AUTO_INCREMENT,
    username VARCHAR(24) COLLATE utf8mb4_unicode_ci NOT NULL,
    email VARCHAR(254) COLLATE utf8mb4_unicode_ci NOT NULL,
    password_hash VARCHAR(255) NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email),
    CONSTRAINT chk_users_role CHECK (role IN ('user', 'owner')),
    CONSTRAINT chk_users_is_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
    id BIGINT NOT NULL AUTO_INCREMENT,
    name VARCHAR(80) COLLATE utf8mb4_unicode_ci NOT NULL,
    slug VARCHAR(80) COLLATE utf8mb4_unicode_ci NOT NULL,
    description TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_categories_name (name),
    UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
    id BIGINT NOT NULL AUTO_INCREMENT,
    owner_id BIGINT NOT NULL,
    category_id BIGINT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    description LONGTEXT NOT NULL DEFAULT (''),
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    version VARCHAR(40) NOT NULL DEFAULT '1.0.0',
    featured TINYINT(1) NOT NULL DEFAULT 0,
    icon_path VARCHAR(255) NULL,
    banner_path VARCHAR(255) NULL,
    screenshots_json LONGTEXT NOT NULL DEFAULT ('[]'),
    features_json LONGTEXT NOT NULL DEFAULT ('[]'),
    requirements LONGTEXT NOT NULL DEFAULT (''),
    changelog LONGTEXT NOT NULL DEFAULT (''),
    external_links_json LONGTEXT NOT NULL DEFAULT ('[]'),
    PRIMARY KEY (id),
    UNIQUE KEY uq_projects_slug (slug),
    KEY idx_projects_owner_id (owner_id),
    KEY idx_projects_category_id (category_id),
    KEY idx_projects_status_created (status, created_at),
    KEY idx_projects_featured (featured, created_at),
    CONSTRAINT fk_projects_owner
        FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_projects_category
        FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
    CONSTRAINT chk_projects_status CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT chk_projects_featured CHECK (featured IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_files (
    id BIGINT NOT NULL AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    uploaded_by BIGINT NOT NULL,
    original_name VARCHAR(180) NOT NULL,
    stored_name VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    version VARCHAR(40) NOT NULL DEFAULT '1.0.0',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_files_stored_name (stored_name),
    KEY idx_project_files_project_id (project_id),
    KEY idx_project_files_status (status, created_at),
    CONSTRAINT fk_project_files_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_project_files_uploaded_by
        FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT chk_project_files_size CHECK (size_bytes >= 0),
    CONSTRAINT chk_project_files_status CHECK (status IN ('active', 'inactive'))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS downloads (
    id BIGINT NOT NULL AUTO_INCREMENT,
    project_file_id BIGINT NOT NULL,
    user_id BIGINT NULL,
    downloaded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_downloads_file_id (project_file_id),
    KEY idx_downloads_user_id (user_id),
    KEY idx_downloads_date (downloaded_at),
    CONSTRAINT fk_downloads_project_file
        FOREIGN KEY (project_file_id) REFERENCES project_files (id) ON DELETE CASCADE,
    CONSTRAINT fk_downloads_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_accounts (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    provider VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
    provider_user_id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_oauth_provider_user (provider, provider_user_id),
    UNIQUE KEY uq_oauth_user_provider (user_id, provider),
    KEY idx_oauth_accounts_user_id (user_id),
    CONSTRAINT fk_oauth_accounts_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT chk_oauth_provider CHECK (provider IN ('google', 'discord'))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_settings (
    `key` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `value` LONGTEXT NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Created by routes/public.js in the Node application, so include it in the
-- migrated schema even though it is not declared in database.js.
CREATE TABLE IF NOT EXISTS contact_messages (
    id BIGINT NOT NULL AUTO_INCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message LONGTEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'new',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_contact_messages_created (created_at),
    CONSTRAINT chk_contact_messages_status CHECK (status IN ('new', 'read', 'closed'))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO site_settings (`key`, `value`) VALUES
    ('site_name', 'C8B'),
    ('site_description', 'Build. Create. Share.'),
    ('default_project_status', 'draft'),
    ('upload_max_mb', '100');
