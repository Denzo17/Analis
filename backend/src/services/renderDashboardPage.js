// Shared HTML shell for the dashboard app, used both by the (currently
// unused, kept for later) amoCRM iframe entry point and by the standalone
// /dashboard page.
function renderDashboardHtml({ accountId, subdomain, lang, sessionToken }) {
  const safeLang = lang === 'en' ? 'en' : 'ru';
  return `<!doctype html>
<html lang="${safeLang}">
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
      lang: ${JSON.stringify(safeLang)}
    };
  </script>
  <script src="/static/js/charts.js"></script>
  <script src="/static/js/filters.js"></script>
  <script src="/static/js/settings-panel.js"></script>
  <script src="/static/js/app.js"></script>
</body>
</html>`;
}

module.exports = { renderDashboardHtml };
