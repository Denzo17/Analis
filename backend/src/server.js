const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const oauthRoutes = require('./routes/oauth');
const widgetRoutes = require('./routes/widget');
const apiRoutes = require('./routes/api');
const dashboardRoutes = require('./routes/dashboard');

const REQUIRED_ENV = ['AMO_CLIENT_ID', 'AMO_CLIENT_SECRET', 'AMO_REDIRECT_URI', 'SESSION_JWT_SECRET', 'DASHBOARD_PASSWORD'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(`[config] Missing env vars: ${missing.join(', ')} — see .env.example`);
}

const app = express();
// Behind nginx — needed so req.ip reflects the real client (X-Forwarded-For)
// instead of always resolving to nginx's own address, which would make the
// login rate limiter in routes/dashboard.js useless.
app.set('trust proxy', 1);
// The dashboard's own JS always calls /api/* same-origin (both are served by
// this same process), so cross-origin access here has no legitimate use —
// restrict it instead of reflecting every origin, which would otherwise let
// any other site's JS read our responses from a browser that happens to hold
// a valid session token.
app.use(cors({ origin: process.env.APP_BASE_URL }));
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/oauth', oauthRoutes);
app.use('/widget', widgetRoutes);
app.use('/api', apiRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/static', express.static(path.join(__dirname, '..', '..', 'frontend')));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Leads analysis backend listening on :${port}`);
});
