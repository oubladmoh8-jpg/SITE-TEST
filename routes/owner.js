'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { db } = require('../database');
const { requireAuth, requireOwner, requireCsrf } = require('../middleware/auth');

const router = express.Router();
const uploadRoot = path.resolve(__dirname, '..', 'uploads');
const projectFilesRoot = path.join(uploadRoot, 'projects');
const imageRoot = path.join(uploadRoot, 'images');
const configuredMax = Number.parseInt(process.env.UPLOAD_MAX_MB || '100', 10);
const maxUploadBytes = Math.max(1, Math.min(Number.isFinite(configuredMax) ? configuredMax : 100, 2048)) * 1024 * 1024;
const maxImageBytes = Math.min(maxUploadBytes, 10 * 1024 * 1024);

for (const directory of [projectFilesRoot, imageRoot]) fs.mkdirSync(directory, { recursive: true });

const allowedFileExtensions = new Set([
  '.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz',
  '.pdf', '.txt', '.md', '.csv', '.json',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.exe', '.msi', '.apk', '.aab', '.jar', '.deb', '.rpm', '.dmg', '.pkg',
  '.docx', '.xlsx', '.pptx',
]);
const allowedImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const mimeByExtension = {
  '.zip': 'application/zip', '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
  '.tar': 'application/x-tar', '.gz': 'application/gzip', '.tgz': 'application/gzip',
  '.bz2': 'application/x-bzip2', '.xz': 'application/x-xz', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi', '.apk': 'application/vnd.android.package-archive',
  '.aab': 'application/octet-stream', '.jar': 'application/java-archive', '.deb': 'application/vnd.debian.binary-package',
  '.rpm': 'application/x-rpm', '.dmg': 'application/x-apple-diskimage', '.pkg': 'application/octet-stream',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function safeDisplayName(value, max = 180) {
  const base = path.basename(String(value || 'download')).replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim();
  return (base || 'download').slice(0, max);
}
function safeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function text(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function integerId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function jsonArray(value, maxItems = 30, itemLength = 300) {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = input.split('\n'); }
  }
  if (!Array.isArray(input)) return [];
  return input.map((entry) => text(typeof entry === 'string' ? entry : '', itemLength)).filter(Boolean).slice(0, maxItems);
}
function jsonObjectArray(value, maxItems = 20) {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = []; }
  }
  if (!Array.isArray(input)) return [];
  return input.slice(0, maxItems).map((item) => ({
    label: text(item && item.label, 80),
    url: text(item && item.url, 500),
  })).filter((item) => item.label && /^https?:\/\//i.test(item.url));
}
function slugWithSuffix(title, exceptId = null) {
  const base = safeSlug(title) || 'project';
  let slug = base;
  let suffix = 2;
  const query = db.prepare('SELECT id FROM projects WHERE slug = ? AND id != ?');
  while (query.get(slug, exceptId || 0)) {
    slug = `${base.slice(0, 70)}-${suffix++}`;
  }
  return slug;
}
function unlinkStored(root, storedName) {
  if (typeof storedName !== 'string' || !/^[a-f0-9-]{36}\.[a-z0-9]{1,10}$/i.test(storedName)) return;
  const absolute = path.resolve(root, storedName);
  if (!absolute.startsWith(root + path.sep)) return;
  try { fs.unlinkSync(absolute); } catch (error) { if (error.code !== 'ENOENT') console.warn('Unable to remove stored upload.'); }
}
function fileSignatureValid(file, imageOnly = false) {
  const ext = path.extname(file.filename).toLowerCase();
  let fd;
  let header;
  try {
    fd = fs.openSync(file.path, 'r');
    header = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    header = header.subarray(0, bytesRead);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const starts = (...bytes) => bytes.every((byte, index) => header[index] === byte);
  if (imageOnly || ['.png','.jpg','.jpeg','.webp','.gif','.pdf','.zip','.docx','.xlsx','.pptx','.apk','.aab','.jar','.gz','.tgz','.7z','.rar','.exe','.msi','.deb','.rpm','.dmg','.tar'].includes(ext)) {
    if (['.jpg','.jpeg'].includes(ext)) return starts(0xff, 0xd8, 0xff);
    if (ext === '.png') return header.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    if (ext === '.gif') return header.subarray(0, 6).toString('ascii').startsWith('GIF87a') || header.subarray(0, 6).toString('ascii').startsWith('GIF89a');
    if (ext === '.webp') return header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
    if (ext === '.pdf') return header.subarray(0, 5).toString('ascii') === '%PDF-';
    if (['.zip','.docx','.xlsx','.pptx','.apk','.aab','.jar'].includes(ext)) return starts(0x50,0x4b,0x03,0x04) || starts(0x50,0x4b,0x05,0x06) || starts(0x50,0x4b,0x07,0x08);
    if (['.gz','.tgz'].includes(ext)) return starts(0x1f,0x8b);
    if (ext === '.7z') return starts(0x37,0x7a,0xbc,0xaf,0x27,0x1c);
    if (ext === '.rar') return header.subarray(0, 7).equals(Buffer.from([0x52,0x61,0x72,0x21,0x1a,0x07,0x00])) || header.subarray(0, 8).equals(Buffer.from([0x52,0x61,0x72,0x21,0x1a,0x07,0x01,0x00]));
    if (ext === '.exe') return starts(0x4d,0x5a);
    if (ext === '.msi') return starts(0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1);
    if (ext === '.deb') return header.subarray(0, 8).toString('ascii') === '!<arch>\n';
    if (ext === '.rpm') return starts(0xed,0xab,0xee,0xdb);
    if (ext === '.dmg') {
      try {
        const stat = fs.statSync(file.path);
        if (stat.size < 512) return false;
        const tailFd = fs.openSync(file.path, 'r');
        const tail = Buffer.alloc(512);
        fs.readSync(tailFd, tail, 0, 512, stat.size - 512);
        fs.closeSync(tailFd);
        return tail.subarray(0, 4).toString('ascii') === 'koly';
      } catch { return false; }
    }
    if (ext === '.tar') return header.subarray(257, 262).toString('ascii') === 'ustar';
  }
  if (imageOnly) return false;
  if (ext === '.json') {
    try {
      if (fs.statSync(file.path).size > 2 * 1024 * 1024) return false;
      JSON.parse(fs.readFileSync(file.path, 'utf8'));
      return true;
    } catch { return false; }
  }
  return true;
}

function fileSummary(row) {
  return {
    id: row.id, projectId: row.project_id, projectTitle: row.project_title || null,
    filename: row.original_name, version: row.version, size: row.size_bytes,
    uploadDate: row.created_at, downloads: row.download_count || 0, status: row.status,
  };
}
function projectSummary(row) {
  return {
    id: row.id, title: row.title, name: row.title, slug: row.slug, description: row.description,
    categoryId: row.category_id, categoryName: row.category_name || null, version: row.version,
    status: row.status, featured: Boolean(row.featured), icon: row.icon_path,
    banner: row.banner_path, screenshots: safeParseArray(row.screenshots_json),
    features: safeParseArray(row.features_json), requirements: row.requirements, changelog: row.changelog,
    externalLinks: safeParseArray(row.external_links_json), createdAt: row.created_at, updatedAt: row.updated_at,
    downloads: row.download_count || 0, files: row.file_count || 0,
  };
}
function safeParseArray(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

const storageFor = (root) => multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, root),
  filename: (_req, file, callback) => {
    const ext = path.extname(safeDisplayName(file.originalname)).toLowerCase();
    callback(null, `${crypto.randomUUID()}${ext}`);
  },
});
const fileUpload = multer({
  storage: storageFor(projectFilesRoot),
  limits: { fileSize: maxUploadBytes, files: 10, fields: 40, fieldSize: 100 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(safeDisplayName(file.originalname)).toLowerCase();
    if (!allowedFileExtensions.has(ext)) return callback(new Error('Unsupported file type. Allowed types include archives, documents, images, and common software packages.'));
    callback(null, true);
  },
});
const imageUpload = multer({
  storage: storageFor(imageRoot),
  limits: { fileSize: maxImageBytes, files: 1, fields: 10, fieldSize: 20 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(safeDisplayName(file.originalname)).toLowerCase();
    if (!allowedImageExtensions.has(ext)) return callback(new Error('Image must be PNG, JPEG, WebP, or GIF.'));
    callback(null, true);
  },
});

router.use(requireAuth, requireOwner);

const getDashboard = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM projects) AS total_projects,
    (SELECT COUNT(*) FROM downloads) AS total_downloads,
    (SELECT COUNT(*) FROM users WHERE role = 'user') AS total_users,
    (SELECT COUNT(*) FROM project_files) AS total_files,
    (SELECT COUNT(*) FROM projects WHERE featured = 1) AS featured_projects
`);
const recentProjectsQuery = db.prepare(`
  SELECT p.*, c.name AS category_name,
    (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count,
    (SELECT COUNT(*) FROM downloads d JOIN project_files f ON f.id = d.project_file_id WHERE f.project_id = p.id) AS download_count
  FROM projects p LEFT JOIN categories c ON c.id = p.category_id
  ORDER BY p.created_at DESC LIMIT 8
`);
const recentDownloadsQuery = db.prepare(`
  SELECT d.id, d.downloaded_at, f.original_name, f.version, p.id AS project_id, p.title AS project_title,
    u.username
  FROM downloads d
  JOIN project_files f ON f.id = d.project_file_id
  JOIN projects p ON p.id = f.project_id
  LEFT JOIN users u ON u.id = d.user_id
  ORDER BY d.downloaded_at DESC LIMIT 10
`);
const popularProjectsQuery = db.prepare(`
  SELECT p.id, p.title, COUNT(d.id) AS downloads
  FROM projects p
  LEFT JOIN project_files f ON f.project_id = p.id
  LEFT JOIN downloads d ON d.project_file_id = f.id
  GROUP BY p.id, p.title
  ORDER BY downloads DESC, p.created_at DESC LIMIT 8
`);
const popularFilesQuery = db.prepare(`
  SELECT f.id, f.original_name AS filename, f.version, p.id AS project_id, p.title AS project_title,
    COUNT(d.id) AS downloads
  FROM project_files f
  JOIN projects p ON p.id = f.project_id
  LEFT JOIN downloads d ON d.project_file_id = f.id
  GROUP BY f.id, f.original_name, f.version, p.id, p.title
  ORDER BY downloads DESC, f.created_at DESC LIMIT 8
`);
const listProjectsQuery = db.prepare(`
  SELECT p.*, c.name AS category_name,
    (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count,
    (SELECT COUNT(*) FROM downloads d JOIN project_files f ON f.id = d.project_file_id WHERE f.project_id = p.id) AS download_count
  FROM projects p LEFT JOIN categories c ON c.id = p.category_id
  ORDER BY p.updated_at DESC
`);
const getProjectQuery = db.prepare(`
  SELECT p.*, c.name AS category_name,
    (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count,
    (SELECT COUNT(*) FROM downloads d JOIN project_files f ON f.id = d.project_file_id WHERE f.project_id = p.id) AS download_count
  FROM projects p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?
`);
const listFilesQuery = db.prepare(`
  SELECT f.*, p.title AS project_title,
    (SELECT COUNT(*) FROM downloads d WHERE d.project_file_id = f.id) AS download_count
  FROM project_files f JOIN projects p ON p.id = f.project_id
  ORDER BY f.created_at DESC
`);
const getFileQuery = db.prepare(`
  SELECT f.*, p.title AS project_title,
    (SELECT COUNT(*) FROM downloads d WHERE d.project_file_id = f.id) AS download_count
  FROM project_files f JOIN projects p ON p.id = f.project_id WHERE f.id = ?
`);
const listCategoriesQuery = db.prepare(`
  SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.category_id = c.id) AS project_count
  FROM categories c ORDER BY c.name COLLATE NOCASE
`);
const listUsersQuery = db.prepare(`
  SELECT id, username, email, role, created_at, updated_at, is_active
  FROM users ORDER BY created_at DESC
`);
const listDownloadsQuery = db.prepare(`
  SELECT d.id, d.downloaded_at, d.user_id, u.username, f.id AS file_id, f.original_name,
    f.version, p.id AS project_id, p.title AS project_title
  FROM downloads d JOIN project_files f ON f.id = d.project_file_id
  JOIN projects p ON p.id = f.project_id LEFT JOIN users u ON u.id = d.user_id
  ORDER BY d.downloaded_at DESC LIMIT 200
`);
const listSettingsQuery = db.prepare('SELECT key, value FROM site_settings ORDER BY key');

router.get('/dashboard', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const stats = getDashboard.get();
  return res.json({
    stats: {
      totalProjects: stats.total_projects, totalDownloads: stats.total_downloads,
      totalUsers: stats.total_users, totalFiles: stats.total_files, featuredProjects: stats.featured_projects,
    },
    recentProjects: recentProjectsQuery.all().map(projectSummary),
    recentDownloads: recentDownloadsQuery.all(),
    popularProjects: popularProjectsQuery.all(),
    popularFiles: popularFilesQuery.all(),
  });
});

router.get('/projects', (_req, res) => res.json({ projects: listProjectsQuery.all().map(projectSummary) }));
router.get('/projects/:id', (req, res) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
  const project = getProjectQuery.get(id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  return res.json({ project: projectSummary(project) });
});

router.post('/projects', requireCsrf, (req, res) => {
  const title = text(req.body && (req.body.title || req.body.name), 120);
  const description = text(req.body && req.body.description, 10000);
  const version = text(req.body && req.body.version, 40) || '1.0.0';
  const categoryId = req.body && req.body.categoryId ? integerId(req.body.categoryId) : null;
  if (title.length < 2) return res.status(400).json({ error: 'Project name must be at least 2 characters.' });
  if (req.body.categoryId && !categoryId) return res.status(400).json({ error: 'Choose a valid category.' });
  if (categoryId && !db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) return res.status(400).json({ error: 'Choose a valid category.' });
  const configuredDefault = db.prepare('SELECT value FROM site_settings WHERE key = ?').get('default_project_status');
  const defaultStatus = configuredDefault && ['draft', 'published', 'archived'].includes(configuredDefault.value) ? configuredDefault.value : 'draft';
  const status = ['draft', 'published', 'archived'].includes(req.body.status) ? req.body.status : defaultStatus;
  const insert = db.prepare(`
    INSERT INTO projects
      (owner_id, category_id, title, slug, description, status, version, featured, requirements, changelog, features_json, external_links_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    const result = insert.run(
      req.user.id, categoryId, title, slugWithSuffix(title), description, status, version,
      req.body.featured === true || req.body.featured === 'true' || req.body.featured === '1' ? 1 : 0,
      text(req.body.requirements, 5000), text(req.body.changelog, 10000),
      JSON.stringify(jsonArray(req.body.features)), JSON.stringify(jsonObjectArray(req.body.externalLinks)),
    );
    return res.status(201).json({ project: projectSummary(getProjectQuery.get(Number(result.lastInsertRowid))) });
  } catch (error) {
    console.error('Project create failed:', error.message);
    return res.status(500).json({ error: 'Could not create project.' });
  }
});

router.put('/projects/:id', requireCsrf, (req, res) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
  const existing = getProjectQuery.get(id);
  if (!existing) return res.status(404).json({ error: 'Project not found.' });
  const title = text(req.body && (req.body.title || req.body.name), 120);
  if (title.length < 2) return res.status(400).json({ error: 'Project name must be at least 2 characters.' });
  const categoryId = req.body.categoryId ? integerId(req.body.categoryId) : null;
  if (req.body.categoryId && (!categoryId || !db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId))) {
    return res.status(400).json({ error: 'Choose a valid category.' });
  }
  const status = ['draft', 'published', 'archived'].includes(req.body.status) ? req.body.status : existing.status;
  db.prepare(`
    UPDATE projects SET title = ?, slug = ?, description = ?, category_id = ?, status = ?, version = ?,
      featured = ?, requirements = ?, changelog = ?, features_json = ?, external_links_json = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(
    title, title === existing.title ? existing.slug : slugWithSuffix(title, id),
    text(req.body.description, 10000), categoryId, status, text(req.body.version, 40) || '1.0.0',
    req.body.featured === true || req.body.featured === 'true' || req.body.featured === '1' ? 1 : 0,
    text(req.body.requirements, 5000), text(req.body.changelog, 10000),
    JSON.stringify(jsonArray(req.body.features)), JSON.stringify(jsonObjectArray(req.body.externalLinks)), id,
  );
  return res.json({ project: projectSummary(getProjectQuery.get(id)) });
});

router.patch('/projects/:id/feature', requireCsrf, (req, res) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
  const featured = req.body && req.body.featured;
  if (typeof featured !== 'boolean') return res.status(400).json({ error: 'Featured must be true or false.' });
  const result = db.prepare("UPDATE projects SET featured = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(featured ? 1 : 0, id);
  if (!result.changes) return res.status(404).json({ error: 'Project not found.' });
  return res.json({ project: projectSummary(getProjectQuery.get(id)) });
});

router.delete('/projects/:id', requireCsrf, (req, res) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
  const existing = getProjectQuery.get(id);
  if (!existing) return res.status(404).json({ error: 'Project not found.' });
  if (req.body && req.body.confirmTitle !== existing.title) {
    return res.status(400).json({ error: 'Type the exact project name to confirm deletion.' });
  }
  const files = db.prepare('SELECT stored_name FROM project_files WHERE project_id = ?').all(id);
  const images = [existing.icon_path, existing.banner_path, ...safeParseArray(existing.screenshots_json)];
  const removeProject = db.transaction(() => db.prepare('DELETE FROM projects WHERE id = ?').run(id));
  removeProject();
  for (const file of files) unlinkStored(projectFilesRoot, file.stored_name);
  for (const imageName of images) unlinkStored(imageRoot, imageName);
  return res.json({ success: true });
});

router.get('/projects/:id/files', (req, res) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) return res.status(404).json({ error: 'Project not found.' });
  const files = db.prepare(`
    SELECT f.*, p.title AS project_title,
      (SELECT COUNT(*) FROM downloads d WHERE d.project_file_id = f.id) AS download_count
    FROM project_files f JOIN projects p ON p.id = f.project_id WHERE f.project_id = ?
    ORDER BY f.created_at DESC
  `).all(id);
  return res.json({ files: files.map(fileSummary) });
});

router.get('/files', (_req, res) => res.json({ files: listFilesQuery.all().map(fileSummary) }));

router.post('/projects/:id/files', requireCsrf, (req, res, next) => {
  const id = integerId(req.params.id);
  if (!id || !db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) return res.status(404).json({ error: 'Project not found.' });
  fileUpload.array('files', 10)(req, res, (error) => {
    if (error) return next(error);
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Choose at least one file to upload.' });
    if (req.files.some((file) => !fileSignatureValid(file))) {
      for (const file of req.files) unlinkStored(projectFilesRoot, file.filename);
      return res.status(400).json({ error: 'One or more files do not match their file extension or contain invalid file data.' });
    }
    const version = text(req.body.version, 40) || '1.0.0';
    const insert = db.prepare(`
      INSERT INTO project_files (project_id, uploaded_by, original_name, stored_name, mime_type, size_bytes, version, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `);
    try {
      const addFiles = db.transaction(() => req.files.map((file) => {
        const ext = path.extname(file.filename).toLowerCase();
        const originalName = safeDisplayName(file.originalname);
        const result = insert.run(id, req.user.id, originalName, file.filename, mimeByExtension[ext] || 'application/octet-stream', file.size, version);
        return getFileQuery.get(Number(result.lastInsertRowid));
      }));
      const saved = addFiles();
      return res.status(201).json({ files: saved.map(fileSummary) });
    } catch (saveError) {
      for (const file of req.files) unlinkStored(projectFilesRoot, file.filename);
      return next(saveError);
    }
  });
});

router.put('/files/:id', requireCsrf, (req, res) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid file ID.' });
  const file = getFileQuery.get(id);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  const filename = safeDisplayName(req.body.filename || file.original_name);
  const version = text(req.body.version, 40) || file.version;
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : file.status;
  db.prepare('UPDATE project_files SET original_name = ?, version = ?, status = ? WHERE id = ?')
    .run(filename, version, status, id);
  return res.json({ file: fileSummary(getFileQuery.get(id)) });
});

router.post('/files/:id/replace', requireCsrf, (req, res, next) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid file ID.' });
  const existing = getFileQuery.get(id);
  if (!existing) return res.status(404).json({ error: 'File not found.' });
  fileUpload.single('file')(req, res, (error) => {
    if (error) return next(error);
    if (!req.file) return res.status(400).json({ error: 'Choose a replacement file.' });
    if (!fileSignatureValid(req.file)) {
      unlinkStored(projectFilesRoot, req.file.filename);
      return res.status(400).json({ error: 'The replacement file does not match its file extension or contains invalid file data.' });
    }
    const ext = path.extname(req.file.filename).toLowerCase();
    try {
      db.prepare(`
        UPDATE project_files SET original_name = ?, stored_name = ?, mime_type = ?, size_bytes = ?, version = ?
        WHERE id = ?
      `).run(
        safeDisplayName(req.body.filename || req.file.originalname),
        req.file.filename, mimeByExtension[ext] || 'application/octet-stream', req.file.size,
        text(req.body.version, 40) || existing.version, id,
      );
      unlinkStored(projectFilesRoot, existing.stored_name);
      return res.json({ file: fileSummary(getFileQuery.get(id)) });
    } catch (saveError) {
      unlinkStored(projectFilesRoot, req.file.filename);
      return next(saveError);
    }
  });
});

router.delete('/files/:id', requireCsrf, (req, res) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid file ID.' });
  const file = getFileQuery.get(id);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  if (req.body && req.body.confirmFilename !== file.original_name) {
    return res.status(400).json({ error: 'Type the exact filename to confirm deletion.' });
  }
  db.prepare('DELETE FROM project_files WHERE id = ?').run(id);
  unlinkStored(projectFilesRoot, file.stored_name);
  return res.json({ success: true });
});

router.post('/projects/:id/media', requireCsrf, (req, res, next) => {
  const id = integerId(req.params.id);
  const mediaType = text(req.query.type, 20);
  if (!id || !db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) return res.status(404).json({ error: 'Project not found.' });
  if (!['icon', 'banner', 'screenshot'].includes(mediaType)) return res.status(400).json({ error: 'Invalid media type.' });
  imageUpload.single('image')(req, res, (error) => {
    if (error) return next(error);
    if (!req.file) return res.status(400).json({ error: 'Choose an image.' });
    if (!fileSignatureValid(req.file, true)) {
      unlinkStored(imageRoot, req.file.filename);
      return res.status(400).json({ error: 'The image content does not match its file extension.' });
    }
    const project = db.prepare('SELECT icon_path, banner_path, screenshots_json FROM projects WHERE id = ?').get(id);
    let old = [];
    if (mediaType === 'icon') old = project.icon_path ? [project.icon_path] : [];
    if (mediaType === 'banner') old = project.banner_path ? [project.banner_path] : [];
    try {
      if (mediaType === 'icon') db.prepare('UPDATE projects SET icon_path = ? WHERE id = ?').run(req.file.filename, id);
      else if (mediaType === 'banner') db.prepare('UPDATE projects SET banner_path = ? WHERE id = ?').run(req.file.filename, id);
      else {
        const shots = safeParseArray(project.screenshots_json);
        if (shots.length >= 10) {
          unlinkStored(imageRoot, req.file.filename);
          return res.status(400).json({ error: 'A project can have at most 10 screenshots.' });
        }
        shots.push(req.file.filename);
        db.prepare('UPDATE projects SET screenshots_json = ? WHERE id = ?').run(JSON.stringify(shots), id);
      }
      for (const oldName of old) unlinkStored(imageRoot, oldName);
      return res.status(201).json({ success: true, filename: req.file.filename, type: mediaType });
    } catch (saveError) {
      unlinkStored(imageRoot, req.file.filename);
      return next(saveError);
    }
  });
});

router.delete('/projects/:id/media/:filename', requireCsrf, (req, res) => {
  const id = integerId(req.params.id);
  const filename = String(req.params.filename || '');
  if (!id || !/^[a-f0-9-]{36}\.[a-z0-9]{1,10}$/i.test(filename)) return res.status(400).json({ error: 'Invalid media reference.' });
  const project = db.prepare('SELECT icon_path, banner_path, screenshots_json FROM projects WHERE id = ?').get(id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  if (project.icon_path === filename) db.prepare('UPDATE projects SET icon_path = NULL WHERE id = ?').run(id);
  else if (project.banner_path === filename) db.prepare('UPDATE projects SET banner_path = NULL WHERE id = ?').run(id);
  else {
    const shots = safeParseArray(project.screenshots_json);
    if (!shots.includes(filename)) return res.status(404).json({ error: 'Image not found for this project.' });
    db.prepare('UPDATE projects SET screenshots_json = ? WHERE id = ?').run(JSON.stringify(shots.filter((name) => name !== filename)), id);
  }
  unlinkStored(imageRoot, filename);
  return res.json({ success: true });
});

router.get('/categories', (_req, res) => res.json({ categories: listCategoriesQuery.all() }));
router.post('/categories', requireCsrf, (req, res) => {
  const name = text(req.body && req.body.name, 80);
  const description = text(req.body && req.body.description, 500);
  if (name.length < 2) return res.status(400).json({ error: 'Category name must be at least 2 characters.' });
  const slug = safeSlug(req.body.slug || name);
  if (!slug) return res.status(400).json({ error: 'Enter a valid category name.' });
  try {
    const result = db.prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)').run(name, slug, description);
    const category = db.prepare('SELECT c.*, 0 AS project_count FROM categories c WHERE c.id = ?').get(Number(result.lastInsertRowid));
    return res.status(201).json({ category });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A category with that name or slug already exists.' });
    return res.status(500).json({ error: 'Could not create category.' });
  }
});
router.put('/categories/:id', requireCsrf, (req, res) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid category ID.' });
  if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(id)) return res.status(404).json({ error: 'Category not found.' });
  const name = text(req.body && req.body.name, 80);
  const slug = safeSlug(req.body && req.body.slug || name);
  const description = text(req.body && req.body.description, 500);
  if (name.length < 2 || !slug) return res.status(400).json({ error: 'Enter a valid category name and slug.' });
  try {
    db.prepare('UPDATE categories SET name = ?, slug = ?, description = ? WHERE id = ?').run(name, slug, description, id);
    return res.json({ category: { id, name, slug, description } });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A category with that name or slug already exists.' });
    return res.status(500).json({ error: 'Could not update category.' });
  }
});
router.delete('/categories/:id', requireCsrf, (req, res) => {
  const id = integerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid category ID.' });
  const category = db.prepare('SELECT id, name FROM categories WHERE id = ?').get(id);
  if (!category) return res.status(404).json({ error: 'Category not found.' });
  const used = db.prepare('SELECT COUNT(*) AS count FROM projects WHERE category_id = ?').get(id).count;
  if (used > 0) return res.status(409).json({ error: 'This category is used by projects. Reassign those projects before deleting the category.' });
  if (req.body && req.body.confirmName !== category.name) return res.status(400).json({ error: 'Type the exact category name to confirm deletion.' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return res.json({ success: true });
});

router.get('/users', (_req, res) => res.json({ users: listUsersQuery.all() }));
router.get('/downloads', (_req, res) => res.json({ downloads: listDownloadsQuery.all() }));
router.get('/settings', (_req, res) => {
  const values = Object.fromEntries(listSettingsQuery.all().map((row) => [row.key, row.value]));
  return res.json({ settings: values, maxUploadMb: Math.floor(maxUploadBytes / 1024 / 1024) });
});
router.put('/settings', requireCsrf, (req, res) => {
  const body = req.body || {};
  const allowed = {
    site_name: text(body.site_name, 80),
    site_description: text(body.site_description, 500),
    default_project_status: ['draft', 'published', 'archived'].includes(body.default_project_status) ? body.default_project_status : 'draft',
  };
  const save = db.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  for (const [key, value] of Object.entries(allowed)) save.run(key, value);
  return res.json({ success: true, settings: Object.fromEntries(listSettingsQuery.all().map((row) => [row.key, row.value])) });
});

router.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is too large. The upload limit is ${Math.floor(maxUploadBytes / 1024 / 1024)} MB for project files and ${Math.floor(maxImageBytes / 1024 / 1024)} MB for images.` });
    return res.status(400).json({ error: 'Upload rejected. Check the number and size of files.' });
  }
  if (error && /Unsupported file type|Image must be/.test(error.message)) return res.status(400).json({ error: error.message });
  console.error('Owner request failed:', error && error.message ? error.message : 'unknown error');
  return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : 'Owner request failed.' });
});

module.exports = router;
