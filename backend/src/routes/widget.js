const express = require('express');
const { verifyWidgetSignature, issueSessionToken } = require('../middleware/session');
const { renderDashboardHtml } = require('../services/renderDashboardPage');

const router = express.Router();

// Entry point for embedding inside amoCRM's own UI via a widget iframe (see
// widget/script.js). Kept for later — the private/OAuth-only integration
// type currently available in this account has no widget-file upload step,
// so day-to-day access goes through the standalone /dashboard route
// instead (see routes/dashboard.js). If in-CRM embedding becomes possible
// later, this route still works unchanged.
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
  res.send(renderDashboardHtml({ accountId, subdomain, lang, sessionToken }));
});

module.exports = router;
