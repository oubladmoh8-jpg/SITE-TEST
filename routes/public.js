'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const rateLimit = require('express-rate-limit');
const { db } = require('../database');
const { requireCsrf } = require('../middleware/auth');

const router = express.Router();
const viewsDir = path.resolve(__dirname, '..', 'views');
const imagesDir = path.resolve(__dirname, '..', 'uploads', 'images');
const shell = fs.readFileSync(path.join(viewsDir, 'public.html'), 'utf8');

db.exec(`
  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'closed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at);
`);

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
function parseArray(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}
function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function mediaUrl(filename) {
  if (typeof filename !== 'string' || !/^[a-f0-9-]{36}\.(png|jpe?g|webp|gif)$/i.test(filename)) return '';
  return `/media/${encodeURIComponent(filename)}`;
}
function publicProjectQuery() {
  return `
    SELECT p.id, p.title, p.slug, p.description, p.status, p.version, p.featured, p.icon_path, p.banner_path,
      p.screenshots_json, p.features_json, p.requirements, p.changelog, p.external_links_json, p.created_at, p.updated_at,
      c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
      (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id AND f.status = 'active') AS file_count,
      (SELECT COUNT(*) FROM downloads d JOIN project_files f ON f.id = d.project_file_id WHERE f.project_id = p.id AND f.status = 'active') AS download_count
    FROM projects p LEFT JOIN categories c ON c.id = p.category_id
  `;
}
const listPublished = db.prepare(publicProjectQuery() + ` WHERE p.status = 'published' ORDER BY p.created_at DESC`);
const featuredPublished = db.prepare(publicProjectQuery() + ` WHERE p.status = 'published' AND p.featured = 1 ORDER BY p.updated_at DESC LIMIT 3`);
const latestPublished = db.prepare(publicProjectQuery() + ` WHERE p.status = 'published' ORDER BY p.created_at DESC LIMIT 6`);
const getPublishedBySlug = db.prepare(publicProjectQuery() + ` WHERE p.status = 'published' AND p.slug = ? LIMIT 1`);
const listPublicCategories = db.prepare(`
  SELECT c.id, c.name, c.slug, c.description,
    (SELECT COUNT(*) FROM projects p WHERE p.category_id = c.id AND p.status = 'published') AS project_count
  FROM categories c
  WHERE EXISTS (SELECT 1 FROM projects p WHERE p.category_id = c.id AND p.status = 'published')
  ORDER BY project_count DESC, c.name COLLATE NOCASE LIMIT 12
`);
const publicFiles = db.prepare(`
  SELECT f.id, f.original_name, f.version, f.size_bytes, f.created_at,
    (SELECT COUNT(*) FROM downloads d WHERE d.project_file_id = f.id) AS download_count
  FROM project_files f
  WHERE f.project_id = ? AND f.status = 'active'
  ORDER BY f.created_at DESC
`);
const siteStats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM projects WHERE status = 'published') AS projects,
    (SELECT COUNT(*) FROM downloads d JOIN project_files f ON f.id = d.project_file_id JOIN projects p ON p.id = f.project_id WHERE p.status = 'published' AND f.status = 'active') AS downloads,
    (SELECT COUNT(*) FROM users WHERE role = 'user' AND is_active = 1) AS users
`);
const mediaReferenced = db.prepare(`
  SELECT 1 FROM projects p WHERE p.status = 'published'
    AND (p.icon_path = ? OR p.banner_path = ? OR EXISTS (
      SELECT 1 FROM json_each(p.screenshots_json) WHERE value = ?
    )) LIMIT 1
`);
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many messages were submitted. Please try again later.' },
});

function nav(page) {
  return {
    NAV_HOME: page === 'home' ? 'aria-current="page"' : '',
    NAV_PROJECTS: page === 'projects' || page === 'detail' ? 'aria-current="page"' : '',
    NAV_ABOUT: page === 'about' ? 'aria-current="page"' : '',
    NAV_CONTACT: page === 'contact' ? 'aria-current="page"' : '',
  };
}
function renderPage(req, { title, description = 'Build. Create. Share.', page = '', content }) {
  const signedIn = Boolean(req.isAuthenticated && req.isAuthenticated() && req.user && req.user.is_active);
  const actions = signedIn
    ? '<a class="button button-secondary button-small" href="/api/auth/logout" data-logout>Sign out</a>'
    : '<a class="button button-secondary button-small" href="/login">Sign in</a><a class="button button-primary button-small" href="/register">Join C8B</a>';
  const values = {
    PAGE_TITLE: escapeHtml(title),
    META_DESCRIPTION: escapeHtml(description.slice(0, 250)),
    HEADER_ACTIONS: actions,
    CONTENT: content,
    ...nav(page),
  };
  let html = shell;
  for (const [key, value] of Object.entries(values)) html = html.replaceAll(`{{${key}}}`, value);
  // Contact form submissions are handled server-side; logout is a CSRF-protected POST.
  return html;
}
function page(req, res, options) {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(renderPage(req, options));
}
function errorPage(req, res, status, heading, message) {
  const code = status === 404 ? '404' : status === 403 ? '403' : '500';
  return page(req, res, {
    title: `${code} — ${heading}`, description: message,
    content: `<section class="error-wrap"><div><span class="error-code">${code} / C8B</span><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p><a class="button button-primary" href="/">Back to home</a> <a class="button button-secondary" href="/projects">Explore projects</a></div></section>`,
  });
}
function projectCard(project) {
  const icon = mediaUrl(project.icon_path);
  const category = project.category_name || 'Uncategorized';
  const name = escapeHtml(project.title);
  const slug = encodeURIComponent(project.slug);
  const image = icon
    ? `<img src="${icon}" alt="" loading="lazy" decoding="async">`
    : `<span class="cover-monogram" aria-hidden="true">${escapeHtml(project.title.slice(0, 2).toUpperCase())}</span>`;
  const description = escapeHtml(project.description || 'A C8B project. Explore the details and available files.');
  const download = Number(project.file_count) > 0
    ? `<a class="button button-secondary button-small" href="/projects/${slug}#downloads">Download</a>`
    : '';
  return `<article class="project-card" data-project-card data-name="${escapeHtml(`${project.title} ${project.description || ''}`.toLowerCase())}" data-category="${escapeHtml(project.category_slug || '')}" data-version="${escapeHtml(project.version || '')}">
    <a class="project-cover" href="/projects/${slug}" aria-label="View ${name}">${image}</a>
    <div class="project-body"><div class="project-meta"><span class="pill pill-accent">${escapeHtml(category)}</span><span class="pill">v${escapeHtml(project.version || '1.0.0')}</span>${project.featured ? '<span class="pill">Featured</span>' : ''}</div>
      <h3><a href="/projects/${slug}">${name}</a></h3><p>${description}</p>
      <div class="project-card-foot"><span class="download-count">↓ ${formatNumber(project.download_count)} downloads</span><div class="project-actions"><a class="text-link" href="/projects/${slug}">View project →</a>${download}</div></div>
    </div>
  </article>`;
}
function projectGrid(projects, emptyTitle = 'Nothing published just yet', emptyText = 'New projects will show up here soon.') {
  if (!projects.length) return `<div class="empty-state"><strong>${escapeHtml(emptyTitle)}</strong>${escapeHtml(emptyText)}</div>`;
  return projects.map(projectCard).join('');
}
function projectStats() {
  const stats = siteStats.get();
  return `<div class="stats-strip"><div class="container stats-grid">
    <div class="stat-item"><span class="stat-mark" aria-hidden="true">▦</span><div><strong>${formatNumber(stats.projects)}</strong><span>Published projects</span></div></div>
    <div class="stat-item"><span class="stat-mark" aria-hidden="true">↓</span><div><strong>${formatNumber(stats.downloads)}</strong><span>Downloads tracked</span></div></div>
    <div class="stat-item"><span class="stat-mark" aria-hidden="true">♙</span><div><strong>${formatNumber(stats.users)}</strong><span>Community members</span></div></div>
  </div></div>`;
}
function homeContent() {
  const featured = featuredPublished.all();
  const latest = latestPublished.all();
  const categories = listPublicCategories.all();
  const categoryCards = categories.length ? categories.map((category, index) => `<a class="category-card" href="/projects?category=${encodeURIComponent(category.slug)}"><span class="category-icon" aria-hidden="true">${['◇','▦','⌘','✦'][index % 4]}</span><span><strong>${escapeHtml(category.name)}</strong><small>${formatNumber(category.project_count)} project${category.project_count === 1 ? '' : 's'}</small></span></a>`).join('') : '<div class="empty-state"><strong>Categories are on the way</strong>Projects will be grouped here as the catalogue grows.</div>';
  return `
    <section class="hero"><div class="container hero-grid"><div class="hero-copy">
      <div class="hero-brand"><img src="/assets/logo.jpeg" data-fallback="/assets/logo.svg" alt="C8B logo"><span>C8B · CREATOR COMMUNITY</span></div>
      <span class="eyebrow">A home for what you build</span><h1>Build. Create.<span>Share.</span></h1>
      <p class="hero-lede">A growing home for projects, games, tools, Minecraft builds, Roblox experiences, Discord bots, applications, and the ideas behind them. Discover something useful, find inspiration, and share what you make.</p>
      <div class="hero-actions"><a class="button button-primary" href="/projects">Explore projects <span aria-hidden="true">→</span></a><a class="button button-secondary" href="https://discord.gg/3rV8GwSfSw" target="_blank" rel="noopener noreferrer">Join Discord ↗</a><a class="button button-secondary" href="https://youtube.com/@cha8abb?si=MW5Gg5SKqKh9wWaR" target="_blank" rel="noopener noreferrer">YouTube ↗</a></div>
      <div class="hero-note"><span class="status-dot"></span>Independent projects. Shared with the community.</div>
    </div><div class="hero-visual" aria-label="C8B project showcase"><div class="showcase-card">
      <div class="showcase-top"><div class="showcase-title"><span class="showcase-mini-logo">C8B</span><span>Creator workspace</span></div><span class="showcase-status">Live catalogue</span></div>
      <div class="showcase-art"><div class="art-grid"></div><div class="art-copy"><small>Build something good</small><strong>Ideas become<br>real projects.</strong><span>Tools · Games · Communities · Code</span></div></div>
      <div class="showcase-list"><div class="showcase-row"><span class="showcase-row-icon">⌘</span><span class="showcase-row-copy"><strong>Tools & applications</strong><small>Utilities made to be useful</small></span><span class="showcase-row-tag">01</span></div><div class="showcase-row"><span class="showcase-row-icon">◇</span><span class="showcase-row-copy"><strong>Games & experiences</strong><small>Minecraft, Roblox, and more</small></span><span class="showcase-row-tag">02</span></div><div class="showcase-row"><span class="showcase-row-icon">✦</span><span class="showcase-row-copy"><strong>Bots & community projects</strong><small>Small ideas, real impact</small></span><span class="showcase-row-tag">03</span></div></div>
    </div></div></div></section>
    ${projectStats()}
    <section class="section"><div class="container"><div class="section-head"><div><span class="eyebrow">Hand-picked</span><h2>Featured projects</h2><p>Standout projects from the C8B catalogue.</p></div><a class="text-link" href="/projects">View all projects →</a></div><div class="project-grid">${projectGrid(featured, 'Featured projects will appear here', 'The Owner can feature published projects from the dashboard.')}</div></div></section>
    <section class="section" style="padding-top:12px"><div class="container"><div class="section-head"><div><span class="eyebrow">Fresh from the community</span><h2>Latest projects</h2><p>Explore recently published releases and experiments.</p></div><a class="text-link" href="/projects">Browse catalogue →</a></div><div class="project-grid">${projectGrid(latest, 'The catalogue is getting ready', 'Once the Owner publishes a project, it will appear here.')}</div></div></section>
    <section class="section" style="padding-top:8px"><div class="container"><div class="section-head"><div><span class="eyebrow">Find your corner</span><h2>Explore categories</h2><p>Jump into a topic and find projects that match your interests.</p></div></div><div class="category-grid">${categoryCards}</div></div></section>
    <section class="section" style="padding-top:12px"><div class="container"><div class="cta-panel"><div><span class="eyebrow">Make something worth sharing</span><h2>Your next project starts here.</h2><p>Join the community, discover new ideas, and keep an eye on what creators are publishing next.</p></div><div class="cta-actions"><a class="button button-primary" href="/register">Join C8B</a><a class="button button-secondary" href="https://discord.gg/3rV8GwSfSw" target="_blank" rel="noopener noreferrer">Join Discord ↗</a></div></div></div></section>`;
}
function projectsContent(req) {
  const projects = listPublished.all();
  const categories = listPublicCategories.all();
  const categoryParam = String(req.query.category || '');
  const options = categories.map((category) => `<option value="${escapeHtml(category.slug)}" ${category.slug === categoryParam ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
  const versions = [...new Set(projects.map((project) => String(project.version || '').trim()).filter(Boolean))].sort((a,b) => b.localeCompare(a, undefined, { numeric: true }));
  const versionOptions = versions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  return `<section class="page-hero"><div class="container"><span class="eyebrow">C8B catalogue</span><h1>Projects, made to be shared.</h1><p>Search tools, games, bots, applications, Minecraft builds, Roblox experiences, and more. Sign in to download files hosted by C8B.</p></div></section>
  <section class="section"><div class="container"><div class="catalog-tools"><div class="field"><label for="project-search">Search projects</label><input class="input" id="project-search" type="search" placeholder="Search by name or description…" autocomplete="off"></div><div class="field"><label for="category-filter">Category</label><select class="select" id="category-filter"><option value="">All categories</option>${options}</select></div><div class="field"><label for="version-filter">Version</label><select class="select" id="version-filter"><option value="">All versions</option>${versionOptions}</select></div></div><p class="filter-result" id="filter-result" aria-live="polite">${projects.length} published project${projects.length === 1 ? '' : 's'}</p><div class="project-grid" id="catalog-grid">${projectGrid(projects, 'No projects published yet', 'Check back soon — new releases will appear here.')}</div><div class="empty-state" id="filtered-empty" hidden><strong>No projects match those filters</strong>Try a different name, category, or version.</div></div></section>`;
}
function detailContent(req, project) {
  const files = publicFiles.all(project.id);
  const icon = mediaUrl(project.icon_path);
  const banner = mediaUrl(project.banner_path);
  const screenshots = parseArray(project.screenshots_json).map(mediaUrl).filter(Boolean);
  const features = parseArray(project.features_json).filter((item) => typeof item === 'string' && item.trim());
  const links = parseArray(project.external_links_json).filter((item) => item && typeof item.label === 'string' && typeof item.url === 'string' && /^https?:\/\//i.test(item.url));
  const signedIn = Boolean(req.isAuthenticated && req.isAuthenticated() && req.user && req.user.is_active);
  const fileItems = files.length ? files.map((file) => `<div class="file-item"><span class="file-icon" aria-hidden="true">↓</span><div class="file-info"><strong>${escapeHtml(file.original_name)}</strong><small>Version ${escapeHtml(file.version || project.version)} · ${formatNumber(Math.round(file.size_bytes / 1024))} KB · Added ${formatDate(file.created_at)}</small></div><span class="file-count">${formatNumber(file.download_count)} downloads</span>${signedIn ? `<a class="button button-primary button-small" data-confirm-download href="/api/download/${file.id}">Download</a>` : '<a class="button button-primary button-small" href="/login">Sign in to download</a>'}</div>`).join('') : '<div class="empty-state"><strong>No files are available yet</strong>The Owner has not published a downloadable file for this project.</div>';
  const featureList = features.length ? `<ul class="feature-list">${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>` : '<p>No features have been listed yet.</p>';
  const screenshotList = screenshots.length ? `<div class="screenshots">${screenshots.map((src, i) => `<a href="${src}" target="_blank" rel="noopener noreferrer" aria-label="Open screenshot ${i + 1}"><img src="${src}" alt="${escapeHtml(project.title)} screenshot ${i + 1}" loading="lazy" decoding="async"></a>`).join('')}</div>` : '<p>No screenshots have been added yet.</p>';
  const linksHtml = links.length ? `<div class="external-list">${links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(link.label)}</span><span aria-hidden="true">↗</span></a>`).join('')}</div>` : '<p>No external links have been added.</p>';
  return `
  <section class="detail-hero">${banner ? `<img class="detail-banner" src="${banner}" alt="" fetchpriority="high">` : ''}<div class="detail-banner-shade"></div><div class="container detail-head"><div class="detail-icon">${icon ? `<img src="${icon}" alt="${escapeHtml(project.title)} icon">` : escapeHtml(project.title.slice(0, 2).toUpperCase())}</div><div class="detail-title"><div class="project-meta"><span class="pill pill-accent">${escapeHtml(project.category_name || 'Uncategorized')}</span><span class="pill">Version ${escapeHtml(project.version)}</span>${project.featured ? '<span class="pill">Featured</span>' : ''}</div><h1>${escapeHtml(project.title)}</h1><p>${escapeHtml(project.description || 'A C8B project.')}</p><div class="detail-actions"><a class="button button-primary" href="#downloads">View downloads ↓</a><a class="button button-secondary" href="/projects">Back to projects</a></div></div></div></section>
  <section class="section"><div class="container detail-layout"><div class="detail-main">
    <article class="content-panel"><h2>About this project</h2><p>${escapeHtml(project.description || 'No extended description has been provided.')}</p></article>
    <article class="content-panel"><h2>Features</h2>${featureList}</article>
    <article class="content-panel"><h2>Requirements</h2><p>${escapeHtml(project.requirements || 'No specific requirements have been listed.')}</p></article>
    <article class="content-panel"><h2>Screenshots</h2>${screenshotList}</article>
    <article class="content-panel"><h2>Changelog</h2><p>${escapeHtml(project.changelog || 'No changelog has been published.')}</p></article>
    <article class="content-panel" id="downloads"><h2>Downloads</h2><p style="margin-bottom:16px">Files are hosted on C8B. Sign in is required to download files and keep download statistics accurate.</p><div class="file-list">${fileItems}</div></article>
  </div><aside class="detail-sidebar">
    <article class="content-panel"><h2>Project details</h2><dl class="meta-list"><div class="meta-row"><dt>Category</dt><dd>${escapeHtml(project.category_name || 'Uncategorized')}</dd></div><div class="meta-row"><dt>Version</dt><dd>${escapeHtml(project.version)}</dd></div><div class="meta-row"><dt>Published</dt><dd>${formatDate(project.created_at)}</dd></div><div class="meta-row"><dt>Downloads</dt><dd>${formatNumber(project.download_count)}</dd></div><div class="meta-row"><dt>Available files</dt><dd>${formatNumber(files.length)}</dd></div></dl></article>
    <article class="content-panel"><h2>External links</h2>${linksHtml}</article>
    <article class="content-panel"><h2>Share C8B</h2><p>Found something useful? Join the community and share it with others.</p><div style="margin-top:14px"><a class="button button-secondary button-small" href="https://discord.gg/3rV8GwSfSw" target="_blank" rel="noopener noreferrer">Join Discord ↗</a></div></article>
  </aside></div></section>`;
}
router.get('/', (req, res) => page(req, res, { title: 'Build. Create. Share.', description: 'Discover projects, games, tools, Minecraft builds, Roblox experiences, Discord bots, and applications on C8B.', page: 'home', content: homeContent() }));
router.get('/projects', (req, res) => page(req, res, { title: 'Projects', description: 'Explore the C8B catalogue of projects, tools, games, bots, and applications.', page: 'projects', content: projectsContent(req) }));
router.get('/projects/:slug', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return errorPage(req, res, 404, 'Project not found', 'That project link is invalid or the project is no longer published.');
  const project = getPublishedBySlug.get(slug);
  if (!project) return errorPage(req, res, 404, 'Project not found', 'That project may have been removed, unpublished, or the link may be incorrect.');
  return page(req, res, { title: project.title, description: project.description || `Learn about ${project.title} on C8B.`, page: 'detail', content: detailContent(req, project) });
});
router.get('/about', (req, res) => page(req, res, {
  title: 'About C8B', description: 'Learn about C8B, a place to build, create, and share projects.', page: 'about',
  content: `<section class="page-hero"><div class="container"><span class="eyebrow">About C8B</span><h1>Built around creativity.<br>Made for sharing.</h1><p>C8B is a home for digital projects and the people who bring them to life — from useful tools and apps to games, bots, and community creations.</p></div></section>
  <section class="section"><div class="container"><div class="about-grid"><article class="value-card"><span>⌘</span><h3>Build useful things</h3><p>Discover applications, utilities, scripts, and tools designed to solve real problems and make everyday tasks easier.</p></article><article class="value-card"><span>◇</span><h3>Explore new worlds</h3><p>Find Minecraft projects, Roblox experiences, game-related resources, and creative experiments worth trying.</p></article><article class="value-card"><span>♙</span><h3>Support creators</h3><p>Give projects a place to be discovered, keep their details together, and make releases easier for people to find.</p></article><article class="value-card"><span>↗</span><h3>Share with confidence</h3><p>Each published project can include versions, requirements, screenshots, changelogs, external links, and hosted downloads.</p></article></div></div></section>
  <section class="section" style="padding-top:0"><div class="container"><div class="cta-panel"><div><span class="eyebrow">The next release could be yours</span><h2>Build. Create. Share.</h2><p>Join C8B and connect with the community around the projects you care about.</p></div><div class="cta-actions"><a class="button button-primary" href="/register">Create an account</a><a class="button button-secondary" href="https://discord.gg/3rV8GwSfSw" target="_blank" rel="noopener noreferrer">Join Discord ↗</a></div></div></div></section>`,
}));
router.get('/contact', (req, res) => page(req, res, {
  title: 'Contact', description: 'Contact the C8B community and send a message to the platform team.', page: 'contact',
  content: `<section class="page-hero"><div class="container"><span class="eyebrow">Get in touch</span><h1>We’re listening.</h1><p>Have a question, found an issue, or want to talk about a project? Send a note or reach the community on Discord.</p></div></section>
  <section class="section"><div class="container contact-grid"><form class="contact-form" id="contact-form"><div><span class="eyebrow">Send a message</span><h2 style="margin:8px 0 0;font-size:24px;letter-spacing:-.04em">How can we help?</h2></div><div class="notice" id="contact-notice" role="status" aria-live="polite" hidden></div><div class="field"><label for="contact-name">Your name</label><input class="input" id="contact-name" name="name" maxlength="80" autocomplete="name" required></div><div class="field"><label for="contact-email">Email address</label><input class="input" id="contact-email" name="email" type="email" maxlength="254" autocomplete="email" required></div><div class="field"><label for="contact-subject">Subject</label><input class="input" id="contact-subject" name="subject" maxlength="120" required></div><div class="field"><label for="contact-message">Message</label><textarea class="textarea" id="contact-message" name="message" minlength="10" maxlength="4000" required placeholder="Tell us a little about what you need…"></textarea></div><button class="button button-primary" type="submit">Send message →</button><small class="muted">Please don’t include passwords or other sensitive information.</small></form><aside class="contact-aside"><span class="eyebrow">Community first</span><h2>Connect with C8B.</h2><p>For community discussions, project questions, and updates, join our official channels.</p><a class="contact-link" href="https://discord.gg/3rV8GwSfSw" target="_blank" rel="noopener noreferrer"><div>Discord community<br><span>Chat with the community</span></div><b>↗</b></a><a class="contact-link" href="https://youtube.com/@cha8abb?si=MW5Gg5SKqKh9wWaR" target="_blank" rel="noopener noreferrer"><div>YouTube<br><span>Watch C8B videos</span></div><b>↗</b></a><div style="margin-top:24px;padding:14px;border-radius:11px;background:#ffffff05;color:var(--muted);font-size:12px">Messages sent through this form are saved securely in the platform database for follow-up.</div></aside></div></section>`,
}));
router.get('/media/:filename', (req, res) => {
  const filename = String(req.params.filename || '');
  if (!/^[a-f0-9-]{36}\.(png|jpe?g|webp|gif)$/i.test(filename) || !mediaReferenced.get(filename, filename, filename)) {
    return res.status(404).type('text/plain').send('Image not found.');
  }
  const absolute = path.resolve(imagesDir, filename);
  if (!absolute.startsWith(imagesDir + path.sep)) return res.status(404).type('text/plain').send('Image not found.');
  let stat;
  try { stat = fs.statSync(absolute); } catch { return res.status(404).type('text/plain').send('Image not found.'); }
  if (!stat.isFile()) return res.status(404).type('text/plain').send('Image not found.');
  const ext = path.extname(filename).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext];
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=86400');
  return res.type(mime).sendFile(absolute);
});
router.post('/api/contact', contactLimiter, requireCsrf, (req, res) => {
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const name = clean(req.body && req.body.name, 80);
  const email = clean(req.body && req.body.email, 254).toLowerCase();
  const subject = clean(req.body && req.body.subject, 120);
  const message = clean(req.body && req.body.message, 4000);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter a name of at least 2 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (subject.length < 3) return res.status(400).json({ error: 'Please enter a subject of at least 3 characters.' });
  if (message.length < 10) return res.status(400).json({ error: 'Please enter a message of at least 10 characters.' });
  try {
    db.prepare('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)').run(name, email, subject, message);
    return res.status(201).json({ success: true, message: 'Your message has been received. Thanks for reaching out.' });
  } catch (error) {
    console.error('Contact message could not be stored:', error.message);
    return res.status(500).json({ error: 'We could not save your message right now. Please try again later.' });
  }
});
router.get('/download/:fileId', (req, res) => {
  const id = Number(req.params.fileId);
  if (!Number.isSafeInteger(id) || id < 1) return errorPage(req, res, 404, 'File not found', 'That download link is invalid or the file is no longer available.');
  const file = db.prepare(`
    SELECT f.id, f.status, p.slug, p.status AS project_status
    FROM project_files f JOIN projects p ON p.id = f.project_id WHERE f.id = ?
  `).get(id);
  if (!file || file.status !== 'active' || file.project_status !== 'published') return errorPage(req, res, 404, 'File not found', 'That file is no longer available.');
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user || !req.user.is_active) return res.redirect('/login');
  return res.redirect(302, `/api/download/${id}`);
});
router.use((req, res) => errorPage(req, res, 404, 'Page not found', 'We couldn’t find that page. The link may be incorrect or the page may have moved.'));

module.exports = { router, errorPage, renderPage };