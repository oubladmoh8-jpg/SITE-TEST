'use strict';

(() => {
  const notice = document.getElementById('auth-notice');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const logoutForm = document.getElementById('logout-form');

  document.querySelectorAll('img[data-primary]').forEach((img) => {
    const candidate = new Image();
    candidate.onload = () => { img.src = img.dataset.primary; };
    candidate.src = img.dataset.primary;
  });

  function showNotice(message) {
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = false;
  }

  function getCsrf() {
    return fetch('/api/auth/csrf', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.csrfToken) {
        throw new Error(payload.error || 'Could not start a secure session. Refresh the page.');
      }
      document.querySelectorAll('input[name="csrfToken"]').forEach((input) => {
        input.value = payload.csrfToken;
      });
      return payload.csrfToken;
    });
  }

  async function submitForm(form, endpoint) {
    const button = form.querySelector('button[type="submit"]');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Please wait…';
    if (notice) notice.hidden = true;
    try {
      const csrfToken = await getCsrf();
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.csrfToken = csrfToken;
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not complete the request.');
      window.location.assign(result.redirect || '/app');
    } catch (error) {
      showNotice(error.message || 'Something went wrong. Please try again.');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  if (loginForm) loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;
    submitForm(loginForm, '/api/auth/login');
  });

  if (registerForm) registerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!registerForm.reportValidity()) return;
    const password = registerForm.elements.password.value;
    const confirmPassword = registerForm.elements.confirmPassword.value;
    if (password !== confirmPassword) return showNotice('Passwords do not match.');
    submitForm(registerForm, '/api/auth/register');
  });

  if (logoutForm) {
    getCsrf().then((token) => {
      logoutForm.querySelector('input[name="csrfToken"]').value = token;
    }).catch((error) => showNotice(error.message));
    logoutForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = logoutForm.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const token = await getCsrf();
        const response = await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, Accept: 'application/json' },
          body: JSON.stringify({ csrfToken: token }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Could not sign out.');
        window.location.assign(result.redirect || '/login');
      } catch (error) {
        showNotice(error.message || 'Could not sign out.');
        button.disabled = false;
      }
    });
  }

  const error = new URLSearchParams(window.location.search).get('error');
  if (error && notice) {
    const messages = {
      oauth_failed: 'OAuth sign-in did not complete. Try another method or check your provider settings.',
      oauth_unavailable: 'That sign-in provider is not configured yet. Use your username/email and password.',
    };
    showNotice(messages[error] || 'Sign-in could not be completed.');
  }

  if (document.body.dataset.page === 'authenticated') {
    fetch('/api/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error('Your session has expired.');
        return response.json();
      })
      .then((payload) => {
        const target = document.getElementById('signed-in-as');
        if (target && payload.user) target.textContent = `Signed in as ${payload.user.username} · ${payload.user.role}`;
      })
      .catch(() => window.location.replace('/login'));
  }
})();
