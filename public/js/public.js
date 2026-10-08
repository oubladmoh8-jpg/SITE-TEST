'use strict';
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const navToggle = $('.nav-toggle');
  const nav = $('#primary-nav');
  if (navToggle && nav) navToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  document.querySelectorAll('img[data-fallback]').forEach((img) => img.addEventListener('error', () => {
    if (img.dataset.fallback && img.src !== new URL(img.dataset.fallback, location.href).href) {
      img.src = img.dataset.fallback;
      img.removeAttribute('data-fallback');
    }
  }, { once: true }));
  const year = $('#current-year');
  if (year) year.textContent = String(new Date().getFullYear());
  const toast = $('#toast');
  function showToast(message, error = false) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
  }
  const search = $('#project-search');
  const category = $('#category-filter');
  const version = $('#version-filter');
  const cards = [...document.querySelectorAll('[data-project-card]')];
  const resultCount = $('#filter-result');
  function applyFilters() {
    const query = (search?.value || '').trim().toLowerCase();
    const cat = category?.value || '';
    const ver = (version?.value || '').trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const matches = (!query || card.dataset.name.includes(query)) &&
        (!cat || card.dataset.category === cat) &&
        (!ver || card.dataset.version.includes(ver));
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    if (resultCount) resultCount.textContent = `${visible} project${visible === 1 ? '' : 's'} shown`;
    const empty = $('#filtered-empty');
    if (empty) empty.hidden = visible > 0;
  }
  [search, category, version].filter(Boolean).forEach((field) => field.addEventListener(field === search ? 'input' : 'change', applyFilters));
  if (cards.length) applyFilters();

  const contactForm = $('#contact-form');
  if (contactForm) contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', contactForm);
    const notice = $('#contact-notice');
    if (!contactForm.reportValidity()) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending…';
    if (notice) { notice.hidden = true; notice.classList.remove('error'); }
    try {
      const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const csrfData = await csrfResponse.json();
      if (!csrfResponse.ok || !csrfData.csrfToken) throw new Error('Could not verify your request. Refresh and try again.');
      const formData = new FormData(contactForm);
      const payload = Object.fromEntries(formData.entries());
      const response = await fetch('/api/contact', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrfData.csrfToken },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Message could not be sent.');
      contactForm.reset();
      if (notice) { notice.textContent = data.message || 'Your message was received.'; notice.hidden = false; }
      showToast('Message received. Thanks for reaching out.');
    } catch (error) {
      if (notice) { notice.textContent = error.message || 'Please try again.'; notice.classList.add('error'); notice.hidden = false; }
      showToast(error.message || 'Message could not be sent.', true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
  document.querySelectorAll('[data-confirm-download]').forEach((link) => link.addEventListener('click', (event) => {
    if (!link.dataset.confirmDownload) return;
    const original = link.textContent;
    link.textContent = 'Starting…';
    setTimeout(() => { link.textContent = original; }, 1800);
  }));
})();