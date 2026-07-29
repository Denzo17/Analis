const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const express = require('express');
const cors = require('cors');

const oauthRoutes = require('./routes/oauth');
const widgetRoutes = require('./routes/widget');
const apiRoutes = require('./routes/api');

const REQUIRED_ENV = ['AMO_CLIENT_ID', 'AMO_CLIENT_SECRET', 'AMO_REDIRECT_URI', 'SESSION_JWT_SECRET'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(`[config] Missing env vars: ${missing.join(', ')} — see .env.example`);
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/oauth', oauthRoutes);
app.use('/widget', widgetRoutes);
app.use('/api', apiRoutes);
app.use('/static', express.static(path.join(__dirname, '..', '..', 'frontend')));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Leads analysis backend listening on :${port}`);
});
