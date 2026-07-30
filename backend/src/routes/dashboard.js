const crypto = require('crypto');
const express = require('express');
const {
  issueLoginToken,
  requireDashboardLogin,
  issueSessionToken,
  LOGIN_COOKIE_NAME
} = require('../middleware/session');
const tokenStore = require('../services/tokenStore');
const { renderDashboardHtml } = require('../services/renderDashboardPage');

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

function passwordMatches(candidate, expected) {
  const candidateBuf = Buffer.from(String(candidate || ''));
  const expectedBuf = Buffer.from(String(expected || ''));
  // Pad to equal length first — timingSafeEqual throws on a length mismatch,
  // and returning early on that mismatch would itself leak the real length.
  const padded = Buffer.alloc(expectedBuf.length);
  candidateBuf.copy(padded);
  return candidateBuf.length === expectedBuf.length && crypto.timingSafeEqual(padded, expectedBuf);
}

// In-memory per-IP throttle for the password form — this is the only gate
// in front of the whole dashboard, so it shouldn't be brute-forceable.
// Resets on process restart, which is an acceptable trade for not adding an
// external store just for this.
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

router.get('/login', (req, res) => {
  const error = req.query.error ? '<p style="color:#d03b3b;margin:0 0 12px">Неверный пароль.</p>' : '';
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Вход — Анализ лидов</title>
</head>
<body style="font-family: system-ui, sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#f5f6f8;">
  <form method="post" action="/dashboard/login" style="background:#fff; padding:32px; border-radius:10px; box-shadow:0 2px 12px rgba(0,0,0,0.08); width:280px;">
    <h2 style="margin:0 0 16px; font-size:16px;">Анализ лидов</h2>
    ${error}
    <input type="password" name="password" placeholder="Пароль" autofocus
      style="width:100%; padding:8px 10px; margin-bottom:12px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;" />
    <button type="submit" style="width:100%; padding:9px; border:none; border-radius:6px; background:#2e6be6; color:#fff; font-size:14px; cursor:pointer;">
      Войти
    </button>
  </form>
</body>
</html>`);
});

router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (isRateLimited(req.ip)) {
    res.status(429).send('Слишком много попыток входа. Попробуйте снова через 15 минут.');
    return;
  }
  const { password } = req.body || {};
  if (!process.env.DASHBOARD_PASSWORD || !passwordMatches(password, process.env.DASHBOARD_PASSWORD)) {
    res.redirect('/dashboard/login?error=1');
    return;
  }
  res.cookie(LOGIN_COOKIE_NAME, issueLoginToken(), COOKIE_OPTIONS);
  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
  res.clearCookie(LOGIN_COOKIE_NAME);
  res.redirect('/dashboard/login');
});

router.get('/', requireDashboardLogin, (req, res) => {
  const accounts = tokenStore.listAccounts();

  if (!accounts.length) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(
      '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#52514e;">' +
        '<p>Пока ни один amoCRM-аккаунт не подключён.</p>' +
        '<p>Установите интеграцию в amoCRM (нажмите «Установить» на странице интеграции) и обновите эту страницу.</p>' +
        '</div>'
    );
    return;
  }

  let account = accounts[0];
  if (req.query.account_id) {
    const found = accounts.find((a) => a.account_id === Number(req.query.account_id));
    if (found) account = found;
  }

  if (accounts.length > 1 && !req.query.account_id) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    const items = accounts
      .map((a) => `<li><a href="/dashboard?account_id=${Number(a.account_id)}">${escapeHtml(a.subdomain)}.amocrm.ru</a></li>`)
      .join('');
    res.send(
      `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;">` +
        `<h3>Выберите аккаунт</h3><ul>${items}</ul></div>`
    );
    return;
  }

  const sessionToken = issueSessionToken({ accountId: account.account_id, subdomain: account.subdomain });
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(
    renderDashboardHtml({
      accountId: account.account_id,
      subdomain: account.subdomain,
      lang: 'ru',
      sessionToken
    })
  );
});

module.exports = router;
