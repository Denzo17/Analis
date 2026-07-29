const express = require('express');
const fetch = require('node-fetch');
const amocrm = require('../services/amocrmClient');
const tokenStore = require('../services/tokenStore');

const router = express.Router();

function normalizeSubdomain(referer) {
  return String(referer)
    .replace(/^https?:\/\//, '')
    .replace(/\.amocrm\.ru.*$/, '')
    .replace(/\.kommo\.com.*$/, '');
}

// Optional entry point: a "Подключить" link/button on your own site can send
// the account admin here, and this redirects them into amoCRM's authorize
// screen. Not required if you only ever install from inside amoCRM's
// integration settings page (that flow lands straight on /oauth/callback).
router.get('/install', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.AMO_CLIENT_ID,
    state: req.query.state || 'install',
    mode: 'post_message'
  });
  res.redirect(`https://www.amocrm.ru/oauth?${params.toString()}`);
});

router.get('/callback', async (req, res) => {
  const { code, referer, error, error_description: errorDescription } = req.query;

  if (error) {
    res.status(400).send(`amoCRM вернул ошибку авторизации: ${error} ${errorDescription || ''}`);
    return;
  }
  if (!code || !referer) {
    res.status(400).send('Отсутствуют обязательные параметры code/referer.');
    return;
  }

  try {
    const subdomain = normalizeSubdomain(referer);
    const tokens = await amocrm.exchangeCodeForTokens(subdomain, code);

    const accountRes = await fetch(`https://${subdomain}.amocrm.ru/api/v4/account`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` }
    });
    if (!accountRes.ok) {
      throw new Error(`Не удалось получить /api/v4/account: ${accountRes.status}`);
    }
    const account = await accountRes.json();

    tokenStore.saveTokens(account.id, subdomain, tokens);

    res.send(`
      <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h2>Виджет «Анализ лидов» подключён</h2>
        <p>Аккаунт ${subdomain}.amocrm.ru успешно авторизован. Это окно можно закрыть.</p>
      </body></html>
    `);
  } catch (err) {
    console.error('oauth callback failed', err);
    res.status(500).send('Не удалось завершить установку. Подробности в логах сервера.');
  }
});

module.exports = router;
