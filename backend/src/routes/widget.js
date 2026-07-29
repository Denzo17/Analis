const express = require('express');
const { verifyWidgetSignature, issueSessionToken } = require('../middleware/session');

const router = express.Router();

// Entry point loaded inside the amoCRM widget's iframe (see widget/script.js).
// Verifies the HMAC signature amoCRM's widget shim generated, then hands the
// static dashboard app a short-lived session token to call /api/* with.
router.get('/', (req, res) => {
  const { account_id: accountId, subdomain, lang } = req.query;

  if (!verifyWidgetSignature({ accountId, subdomain })) {
    res.status(403).send(
      'Аккаунт не подключён. Установите интеграцию через amoCRM (Настройки → Интеграции) прежде чем открывать виджет.'
    );
    return;
  }

  const sessionToken = issueSessionToken({ accountId: Number(accountId), subdomain });

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'ru'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Анализ лидов</title>
  <link rel="stylesheet" href="/static/css/dashboard.css" />
</head>
<body>
  <div id="app" class="la-app">Загрузка…</div>
  <script>
    window.__LEADS_ANALYSIS_SESSION__ = {
      token: ${JSON.stringify(sessionToken)},
      accountId: ${JSON.stringify(Number(accountId))},
      subdomain: ${JSON.stringify(subdomain)},
      lang: ${JSON.stringify(lang === 'en' ? 'en' : 'ru')}
    };
  </script>
  <script src="/static/js/charts.js"></script>
  <script src="/static/js/filters.js"></script>
  <script src="/static/js/settings-panel.js"></script>
  <script src="/static/js/app.js"></script>
</body>
</html>`);
});

module.exports = router;
