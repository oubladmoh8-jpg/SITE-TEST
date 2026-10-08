'use strict';

(() => {
  const state = { csrf: '', user: null, projects: [], files: [], categories: [], mediaProjectId: null };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const notice = $('#page-notice');
  document.querySelectorAll('img[data-primary]').forEach((img) => {
    const candidate = new Image();
    candidate.onload = () => { img.src = img.dataset.primary; };
    candidate.src = img.dataset.primary;
  });
  const titles = {
    dashboard: 'Dashboard overview', projects: 'Project management', files: 'Hosted files',
    categories: 'Category management', downloads: 'Download activity', users: 'User accounts', settings: 'Site settings',
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }
  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  function formatSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let amount = bytes / 1024;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`;
  }
  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle('error', isError);
    notice.hidden = false;
    notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => { notice.hidden = true; }, 6500);
  }
  async function getCsrf() {
    const response = await fetch('/api/auth/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.csrfToken) throw new Error('Your secure session could not be verified. Please refresh and sign in again.');
    state.csrf = data.csrfToken;
    return state.csrf;
  }
  async function api(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    let body = options.body;
    if (method !== 'GET' && method !== 'HEAD') {
      headers['X-CSRF-Token'] = state.csrf || await getCsrf();
      if (body && !(body instanceof FormData) && typeof body !== 'string') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
    }
    const response = await fetch(url, { ...options, method, headers, body, credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('Please sign in again.');
    }
    if (response.status === 403) throw new Error(data.error || 'You do not have permission to do that.');
    if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
    return data;
  }
  function setView(view) {
    if (!titles[view]) return;
    $$('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`));
    $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
    $('#page-title').textContent = titles[view];
    $('#sidebar').classList.remove('open');
    const loaders = { dashboard: loadDashboard, projects: loadProjects, files: loadFiles, categories: loadCategories, downloads: loadDownloads, users: loadUsers, settings: loadSettings };
    Promise.resolve(loaders[view]()).catch((error) => showNotice(error.message, true));
  }
  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    else if (dialog) dialog.setAttribute('open', '');
  }
  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && typeof dialog.close === 'function') dialog.close();
    else if (dialog) dialog.removeAttribute('open');
  }
  function badge(status) {
    const value = String(status || 'unknown').toLowerCase();
    return `<span class="badge ${escapeHtml(value)}">${escapeHtml(value)}</span>`;
  }
  function projectIcon(project) {
    return `<span class="project-icon">${escapeHtml((project.title || 'P').trim().slice(0, 1).toUpperCase())}</span>`;
  }
  async function loadIdentity() {
    const data = await api('/api/auth/me');
    state.user = data.user;
    const username = data.user.username || 'Owner';
    $('#owner-username').textContent = username;
    $('#welcome-name').textContent = username;
    $('#top-avatar').textContent = username.slice(0, 1).toUpperCase();
    $$('.avatar').forEach((avatar) => { if (avatar.id !== 'top-avatar') avatar.textContent = username.slice(0, 1).toUpperCase(); });
    if (data.user.role !== 'owner') {
      document.body.innerHTML = '<main style="padding:3rem;font-family:system-ui;color:#f2f5ff;background:#0b0d16;min-height:100vh"><h1>403 — Access denied</h1><p>This area is reserved for the Owner account.</p><a href="/app">Return to the application</a></main>';
      throw new Error('Owner access required.');
    }
  }
  async function loadDashboard() {
    const data = await api('/api/owner/dashboard');
    const stats = data.stats || {};
    $('#stat-projects').textContent = stats.totalProjects ?? 0;
    $('#stat-downloads').textContent = stats.totalDownloads ?? 0;
    $('#stat-users').textContent = stats.totalUsers ?? 0;
    $('#stat-files').textContent = stats.totalFiles ?? 0;
    $('#stat-featured').textContent = stats.featuredProjects ?? 0;
    $('#recent-projects').innerHTML = data.recentProjects.length ? data.recentProjects.map((project) => `
      <div class="project-row">${projectIcon(project)}<div class="project-row-main"><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml(project.categoryName || 'Uncategorized')} · v${escapeHtml(project.version)}</small></div><div class="row-end"><strong>${Number(project.downloads || 0).toLocaleString()}</strong><small>downloads</small></div><button class="table-action" data-edit-project="${project.id}">Edit</button></div>`).join('') : '<div class="empty-state">No projects yet. Create your first project to get started.</div>';
    $('#popular-projects').innerHTML = data.popularProjects.length ? data.popularProjects.map((project, index) => `<div class="rank-row"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="rank-title">${escapeHtml(project.title)}</span><span class="rank-count">${Number(project.downloads || 0).toLocaleString()}</span></div>`).join('') : '<div class="empty-state">Download rankings will appear here.</div>';
    $('#recent-downloads').innerHTML = data.recentDownloads.length ? data.recentDownloads.map((item) => `<tr><td><span class="table-primary">${escapeHtml(item.original_name)}</span><span class="table-secondary">v${escapeHtml(item.version)}</span></td><td>${escapeHtml(item.project_title)}</td><td>${escapeHtml(item.username || 'Signed-in user')}</td><td>${escapeHtml(formatDate(item.downloaded_at))}</td></tr>`).join('') : '<tr><td colspan="4"><div class="empty-state">No downloads recorded yet.</div></td></tr>';
    $('#popular-files').innerHTML = (data.popularFiles || []).length ? data.popularFiles.map((file) => `<tr><td><span class="table-primary">${escapeHtml(file.filename)}</span></td><td><button class="text-button" data-view-project="${file.project_id}">${escapeHtml(file.project_title)}</button></td><td>v${escapeHtml(file.version)}</td><td>${Number(file.downloads || 0).toLocaleString()}</td><td><a class="table-action" href="/api/download/${file.id}">Download</a></td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">Download rankings will appear here.</div></td></tr>';
  }
  async function loadProjects() {
    const data = await api('/api/owner/projects');
    state.projects = data.projects || [];
    const search = ($('#project-search')?.value || '').toLowerCase();
    const projects = state.projects.filter((project) => `${project.title} ${project.categoryName || ''} ${project.slug}`.toLowerCase().includes(search));
    $('#project-count').textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}`;
    $('#projects-table').innerHTML = projects.length ? projects.map((project) => `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">${projectIcon(project)}<div><span class="table-primary">${escapeHtml(project.title)} ${project.featured ? '✦' : ''}</span><span class="table-secondary">${escapeHtml(project.slug)}</span></div></div></td>
      <td>${escapeHtml(project.categoryName || 'Uncategorized')}</td><td>v${escapeHtml(project.version)}</td><td>${badge(project.status)}</td><td>${Number(project.downloads || 0).toLocaleString()}</td>
      <td><div class="table-actions"><button class="table-action" data-edit-project="${project.id}">Edit</button><button class="table-action" data-upload-project="${project.id}">Files</button><button class="table-action" data-feature-project="${project.id}" data-featured="${project.featured}">${project.featured ? 'Unfeature' : 'Feature'}</button><button class="table-action danger" data-delete-project="${project.id}">Delete</button></div></td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty-state">No matching projects found.</div></td></tr>';
    fillProjectSelects();
  }
  function fillProjectSelects() {
    const options = state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.title)}</option>`).join('');
    $('#upload-project').innerHTML = options || '<option value="">Create a project first</option>';
  }
  async function loadFiles() {
    const data = await api('/api/owner/files');
    state.files = data.files || [];
    const search = ($('#file-search')?.value || '').toLowerCase();
    const files = state.files.filter((file) => `${file.filename} ${file.projectTitle || ''}`.toLowerCase().includes(search));
    $('#file-count').textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
    $('#files-table').innerHTML = files.length ? files.map((file) => `<tr>
      <td><span class="table-primary">${escapeHtml(file.filename)}</span><span class="table-secondary">ID ${file.id}</span></td>
      <td><button class="text-button" data-view-project="${file.projectId}">${escapeHtml(file.projectTitle || 'Project')}</button></td>
      <td>v${escapeHtml(file.version)}</td><td>${formatSize(file.size)}</td><td>${Number(file.downloads || 0).toLocaleString()}</td><td>${escapeHtml(formatDate(file.uploadDate))}</td><td>${badge(file.status)}</td>
      <td><div class="table-actions"><button class="table-action" data-edit-file="${file.id}">Edit</button><button class="table-action" data-replace-file="${file.id}">Replace</button><a class="table-action" href="/api/download/${file.id}">Test</a><button class="table-action danger" data-delete-file="${file.id}">Delete</button></div></td>
    </tr>`).join('') : '<tr><td colspan="8"><div class="empty-state">No hosted files yet. Upload files from a project.</div></td></tr>';
  }
  async function loadCategories() {
    const data = await api('/api/owner/categories');
    state.categories = data.categories || [];
    $('#categories-table').innerHTML = state.categories.length ? state.categories.map((category) => `<tr><td><span class="table-primary">${escapeHtml(category.name)}</span></td><td><code>${escapeHtml(category.slug)}</code></td><td>${escapeHtml(category.description || '—')}</td><td>${category.project_count}</td><td><div class="table-actions"><button class="table-action" data-edit-category="${category.id}">Edit</button><button class="table-action danger" data-delete-category="${category.id}">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">No categories yet.</div></td></tr>';
    const options = '<option value="">Uncategorized</option>' + state.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('');
    $('#project-category').innerHTML = options;
  }
  async function loadDownloads() {
    const data = await api('/api/owner/downloads');
    $('#downloads-table').innerHTML = data.downloads.length ? data.downloads.map((item) => `<tr><td><span class="table-primary">${escapeHtml(item.original_name)}</span><span class="table-secondary">File #${item.file_id}</span></td><td><button class="text-button" data-view-project="${item.project_id}">${escapeHtml(item.project_title)}</button></td><td>v${escapeHtml(item.version)}</td><td>${escapeHtml(item.username || 'Account unavailable')}</td><td>${escapeHtml(formatDate(item.downloaded_at))}</td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">No downloads recorded yet.</div></td></tr>';
  }
  async function loadUsers() {
    const data = await api('/api/owner/users');
    $('#users-table').innerHTML = data.users.length ? data.users.map((user) => `<tr><td><span class="table-primary">${escapeHtml(user.username)}</span><span class="table-secondary">#${user.id}</span></td><td>${escapeHtml(user.email)}</td><td>${badge(user.role)}</td><td>${escapeHtml(formatDate(user.created_at))}</td><td>${escapeHtml(formatDate(user.updated_at))}</td><td>${badge(user.is_active ? 'active' : 'inactive')}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty-state">No user accounts found.</div></td></tr>';
  }
  async function loadSettings() {
    const data = await api('/api/owner/settings');
    const settings = data.settings || {};
    $('#setting-site-name').value = settings.site_name || 'C8B';
    $('#setting-site-description').value = settings.site_description || '';
    $('#setting-default-status').value = settings.default_project_status || 'draft';
    $('#upload-limit-note').textContent = `${data.maxUploadMb} MB maximum per project file; images are capped at 10 MB. Change UPLOAD_MAX_MB in .env to adjust the server limit.`;
  }
  async function loadProjectEditor(id = null) {
    await Promise.all([state.categories.length ? Promise.resolve() : loadCategories(), state.projects.length ? Promise.resolve() : loadProjects()]);
    const form = $('#project-form');
    form.reset();
    form.elements.id.value = '';
    form.elements.version.value = '1.0.0';
    form.elements.status.value = 'draft';
    $('#project-dialog-title').textContent = id ? 'Edit project' : 'Create project';
    $('#project-media-area').hidden = !id;
    state.mediaProjectId = id;
    $('#media-list').innerHTML = '';
    if (id) {
      const project = (await api(`/api/owner/projects/${id}`)).project;
      form.elements.id.value = project.id;
      form.elements.title.value = project.title || '';
      form.elements.version.value = project.version || '1.0.0';
      form.elements.categoryId.value = project.categoryId || '';
      form.elements.status.value = project.status || 'draft';
      form.elements.featured.checked = Boolean(project.featured);
      form.elements.description.value = project.description || '';
      form.elements.features.value = (project.features || []).join('\n');
      form.elements.requirements.value = project.requirements || '';
      form.elements.changelog.value = project.changelog || '';
      form.elements.externalLinks.value = (project.externalLinks || []).map((item) => `${item.label} | ${item.url}`).join('\n');
      const media = [];
      if (project.icon) media.push({ type: 'icon', name: project.icon });
      if (project.banner) media.push({ type: 'banner', name: project.banner });
      (project.screenshots || []).forEach((name) => media.push({ type: 'screenshot', name }));
      $('#media-list').innerHTML = media.map((item) => `<span class="media-chip">${escapeHtml(item.type)}: ${escapeHtml(item.name)} <button type="button" aria-label="Remove image" data-remove-media="${escapeHtml(item.name)}">×</button></span>`).join('');
    }
    openDialog('project-dialog');
  }
  function projectPayload(form) {
    const data = new FormData(form);
    const externalLinks = String(data.get('externalLinks') || '').split('\n').map((line) => {
      const parts = line.split('|');
      return { label: (parts.shift() || '').trim(), url: parts.join('|').trim() };
    }).filter((item) => item.label && /^https?:\/\//i.test(item.url));
    return {
      title: String(data.get('title') || '').trim(), version: String(data.get('version') || '').trim(),
      categoryId: String(data.get('categoryId') || '') || null, status: data.get('status'),
      featured: data.get('featured') === 'on', description: data.get('description') || '',
      features: String(data.get('features') || '').split('\n').map((item) => item.trim()).filter(Boolean),
      requirements: data.get('requirements') || '', changelog: data.get('changelog') || '', externalLinks,
    };
  }
  async function saveProject(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const id = form.elements.id.value;
    try {
      const payload = projectPayload(form);
      const result = id
        ? await api(`/api/owner/projects/${id}`, { method: 'PUT', body: payload })
        : await api('/api/owner/projects', { method: 'POST', body: payload });
      closeDialog('project-dialog');
      showNotice(id ? 'Project updated.' : 'Project created.');
      await Promise.all([loadProjects(), loadDashboard(), loadFiles()]);
    } catch (error) { showNotice(error.message, true); }
  }
  async function openCategoryEditor(id = null) {
    const form = $('#category-form');
    form.reset();
    form.elements.id.value = '';
    $('#category-dialog-title').textContent = id ? 'Edit category' : 'New category';
    if (id) {
      const category = state.categories.find((item) => item.id === id);
      if (!category) return;
      form.elements.id.value = category.id;
      form.elements.name.value = category.name;
      form.elements.slug.value = category.slug;
      form.elements.description.value = category.description || '';
    }
    openDialog('category-dialog');
  }
  async function saveCategory(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const id = form.elements.id.value;
    const payload = { name: form.elements.name.value.trim(), slug: form.elements.slug.value.trim(), description: form.elements.description.value.trim() };
    try {
      await api(id ? `/api/owner/categories/${id}` : '/api/owner/categories', { method: id ? 'PUT' : 'POST', body: payload });
      closeDialog('category-dialog');
      showNotice(id ? 'Category updated.' : 'Category created.');
      await Promise.all([loadCategories(), loadProjects()]);
    } catch (error) { showNotice(error.message, true); }
  }
  async function uploadFiles(projectId = null) {
    await loadProjects();
    if (!state.projects.length) return showNotice('Create a project before uploading files.', true);
    $('#upload-form').reset();
    $('#upload-version').value = '1.0.0';
    if (projectId) $('#upload-project').value = String(projectId);
    openDialog('upload-dialog');
  }
  async function submitUpload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const files = $('#upload-files').files;
    if (!files.length) return showNotice('Choose at least one file.', true);
    if (files.length > 10) return showNotice('Choose no more than 10 files per upload.', true);
    const projectId = $('#upload-project').value;
    const body = new FormData();
    body.append('version', $('#upload-version').value || '1.0.0');
    for (const file of files) body.append('files', file);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api(`/api/owner/projects/${projectId}/files`, { method: 'POST', body });
      closeDialog('upload-dialog');
      showNotice(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'} to local server storage.`);
      await Promise.all([loadFiles(), loadDashboard(), loadProjects()]);
    } catch (error) { showNotice(error.message, true); }
    finally { button.disabled = false; }
  }
  async function editFile(id) {
    const file = state.files.find((item) => item.id === id);
    if (!file) return;
    const form = $('#file-form');
    form.reset();
    form.elements.id.value = file.id;
    form.elements.filename.value = file.filename;
    form.elements.version.value = file.version || '1.0.0';
    form.elements.status.value = file.status || 'active';
    openDialog('file-dialog');
  }
  async function saveFile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.id.value;
    try {
      await api(`/api/owner/files/${id}`, { method: 'PUT', body: {
        filename: form.elements.filename.value.trim(), version: form.elements.version.value.trim(), status: form.elements.status.value,
      }});
      closeDialog('file-dialog');
      showNotice('File details updated.');
      await Promise.all([loadFiles(), loadDashboard()]);
    } catch (error) { showNotice(error.message, true); }
  }
  async function replaceFile(id) {
    const file = state.files.find((item) => item.id === id);
    if (!file) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.addEventListener('change', async () => {
      if (!input.files || !input.files[0]) return;
      const chosen = input.files[0];
      if (!window.confirm(`Replace “${file.filename}” with “${chosen.name}”? The existing stored file will be removed after replacement.`)) return;
      const version = window.prompt('Version for the replacement file:', file.version || '1.0.0');
      if (version === null) return;
      const body = new FormData();
      body.append('file', chosen);
      body.append('version', version);
      body.append('filename', chosen.name);
      try {
        await api(`/api/owner/files/${id}/replace`, { method: 'POST', body });
        showNotice('File replaced successfully.');
        await Promise.all([loadFiles(), loadDashboard(), loadProjects()]);
      } catch (error) { showNotice(error.message, true); }
    });
    input.click();
  }
  async function uploadMedia(type) {
    const projectId = state.mediaProjectId;
    if (!projectId) return;
    const input = document.getElementById(`media-${type}`);
    if (!input.files || !input.files[0]) return showNotice('Choose an image first.', true);
    const body = new FormData();
    body.append('image', input.files[0]);
    try {
      await api(`/api/owner/projects/${projectId}/media?type=${encodeURIComponent(type)}`, { method: 'POST', body });
      showNotice(`${type === 'screenshot' ? 'Screenshot' : type === 'icon' ? 'Icon' : 'Banner'} uploaded.`);
      input.value = '';
      await loadProjectEditor(projectId);
    } catch (error) { showNotice(error.message, true); }
  }
  async function removeMedia(filename) {
    if (!state.mediaProjectId || !window.confirm('Remove this image from the project?')) return;
    try {
      await api(`/api/owner/projects/${state.mediaProjectId}/media/${encodeURIComponent(filename)}`, { method: 'DELETE', body: {} });
      await loadProjectEditor(state.mediaProjectId);
      showNotice('Project image removed.');
    } catch (error) { showNotice(error.message, true); }
  }
  async function deleteProject(id) {
    const project = state.projects.find((item) => item.id === id);
    if (!project) return;
    const confirmTitle = window.prompt(`This permanently deletes “${project.title}”, its stored files, images, and associated download history. Type the exact project name to confirm:`);
    if (confirmTitle === null) return;
    try {
      await api(`/api/owner/projects/${id}`, { method: 'DELETE', body: { confirmTitle } });
      showNotice('Project and its stored files deleted.');
      await Promise.all([loadProjects(), loadDashboard(), loadFiles(), loadCategories()]);
    } catch (error) { showNotice(error.message, true); }
  }
  async function deleteFile(id) {
    const file = state.files.find((item) => item.id === id);
    if (!file) return;
    const confirmFilename = window.prompt(`This permanently deletes the stored file “${file.filename}”. Type the exact filename to confirm:`);
    if (confirmFilename === null) return;
    try {
      await api(`/api/owner/files/${id}`, { method: 'DELETE', body: { confirmFilename } });
      showNotice('File deleted from server storage.');
      await Promise.all([loadFiles(), loadDashboard(), loadProjects()]);
    } catch (error) { showNotice(error.message, true); }
  }
  async function deleteCategory(id) {
    const category = state.categories.find((item) => item.id === id);
    if (!category) return;
    const confirmName = window.prompt(`Category “${category.name}” can only be deleted when no projects use it. Type its exact name to confirm:`);
    if (confirmName === null) return;
    try {
      await api(`/api/owner/categories/${id}`, { method: 'DELETE', body: { confirmName } });
      showNotice('Category deleted.');
      await Promise.all([loadCategories(), loadProjects()]);
    } catch (error) { showNotice(error.message, true); }
  }
  async function featureProject(id, featured) {
    try {
      await api(`/api/owner/projects/${id}/feature`, { method: 'PATCH', body: { featured: !featured } });
      showNotice(featured ? 'Project unfeatured.' : 'Project featured.');
      await Promise.all([loadProjects(), loadDashboard()]);
    } catch (error) { showNotice(error.message, true); }
  }
  async function viewProject(id) {
    setView('projects');
    try {
      await loadProjectEditor(id);
    } catch (error) { showNotice(error.message, true); }
  }
  async function saveSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/owner/settings', { method: 'PUT', body: {
        site_name: form.elements.site_name.value.trim(),
        site_description: form.elements.site_description.value.trim(),
        default_project_status: form.elements.default_project_status.value,
      }});
      showNotice('Site settings saved.');
    } catch (error) { showNotice(error.message, true); }
  }
  async function logout() {
    if (!window.confirm('Sign out of the Owner Dashboard?')) return;
    try {
      const token = state.csrf || await getCsrf();
      const response = await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, Accept: 'application/json' },
        body: JSON.stringify({ csrfToken: token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not sign out.');
      window.location.assign(data.redirect || '/login');
    } catch (error) { showNotice(error.message, true); }
  }

  document.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-view]');
    if (nav) return setView(nav.dataset.view);
    const viewLink = event.target.closest('[data-view-link]');
    if (viewLink) return setView(viewLink.dataset.viewLink);
    const action = event.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'new-project') return loadProjectEditor().catch((error) => showNotice(error.message, true));
      if (action.dataset.action === 'new-category') return openCategoryEditor();
      if (action.dataset.action === 'upload-file') return uploadFiles().catch((error) => showNotice(error.message, true));
    }
    const close = event.target.closest('[data-close]');
    if (close) return closeDialog(close.dataset.close);
    const editProjectButton = event.target.closest('[data-edit-project]');
    if (editProjectButton) return loadProjectEditor(Number(editProjectButton.dataset.editProject)).catch((error) => showNotice(error.message, true));
    const uploadProjectButton = event.target.closest('[data-upload-project]');
    if (uploadProjectButton) return uploadFiles(Number(uploadProjectButton.dataset.uploadProject)).catch((error) => showNotice(error.message, true));
    const featureButton = event.target.closest('[data-feature-project]');
    if (featureButton) return featureProject(Number(featureButton.dataset.featureProject), featureButton.dataset.featured === 'true');
    const deleteProjectButton = event.target.closest('[data-delete-project]');
    if (deleteProjectButton) return deleteProject(Number(deleteProjectButton.dataset.deleteProject));
    const editCategoryButton = event.target.closest('[data-edit-category]');
    if (editCategoryButton) return openCategoryEditor(Number(editCategoryButton.dataset.editCategory));
    const deleteCategoryButton = event.target.closest('[data-delete-category]');
    if (deleteCategoryButton) return deleteCategory(Number(deleteCategoryButton.dataset.deleteCategory));
    const editFileButton = event.target.closest('[data-edit-file]');
    if (editFileButton) return editFile(Number(editFileButton.dataset.editFile));
    const replaceFileButton = event.target.closest('[data-replace-file]');
    if (replaceFileButton) return replaceFile(Number(replaceFileButton.dataset.replaceFile));
    const deleteFileButton = event.target.closest('[data-delete-file]');
    if (deleteFileButton) return deleteFile(Number(deleteFileButton.dataset.deleteFile));
    const projectLink = event.target.closest('[data-view-project]');
    if (projectLink) return viewProject(Number(projectLink.dataset.viewProject));
    const mediaButton = event.target.closest('[data-media]');
    if (mediaButton) return uploadMedia(mediaButton.dataset.media);
    const removeMediaButton = event.target.closest('[data-remove-media]');
    if (removeMediaButton) return removeMedia(removeMediaButton.dataset.removeMedia);
  });
  $('#project-form').addEventListener('submit', saveProject);
  $('#category-form').addEventListener('submit', saveCategory);
  $('#upload-form').addEventListener('submit', submitUpload);
  $('#file-form').addEventListener('submit', saveFile);
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#logout-button').addEventListener('click', logout);
  $('#project-search').addEventListener('input', () => {
    const search = $('#project-search').value.toLowerCase();
    const rows = $$('#projects-table tr');
    rows.forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(search); });
  });
  $('#file-search').addEventListener('input', () => {
    const search = $('#file-search').value.toLowerCase();
    $$('#files-table tr').forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(search); });
  });
  $('#mobile-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#category-name').addEventListener('input', () => {
    const slug = $('#category-slug');
    if (!$('#category-form').elements.id.value || !slug.dataset.edited) {
      slug.value = $('#category-name').value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
  });
  $('#category-slug').addEventListener('input', (event) => { event.currentTarget.dataset.edited = 'true'; });

  (async () => {
    try {
      await getCsrf();
      await loadIdentity();
      await Promise.all([loadDashboard(), loadProjects(), loadCategories()]);
    } catch (error) {
      if (error.message !== 'Owner access required.') showNotice(error.message, true);
    }
  })();
})();
