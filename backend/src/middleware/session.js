const jwt = require('jsonwebtoken');
const tokenStore = require('../services/tokenStore');

const SESSION_TOKEN_TTL_SECONDS = 60 * 60; // 1h, re-issued on every widget iframe load

// IMPORTANT: AMO_CLIENT_SECRET is shared by every account that installs this
// integration, so script.js (running in the customer's browser) must never
// hold it — an HMAC "signed" client-side with a secret the client also has
// proves nothing. Instead we trust account_id/subdomain only insofar as
// that account already completed the real OAuth install (tokenStore has a
// matching, server-obtained refresh token for it). That's real proof: an
// attacker guessing another installed account's numeric id still can't get
// past this without also matching its stored subdomain.
//
// TODO (harden before going fully public): amoCRM's widget SDK exposes a
// per-session value on self.system() (commonly amouser_hash in older SDK
// versions) meant for exactly this "prove the iframe load came from inside
// a live amoCRM session" check. Confirm the exact field via DevTools against
// a live test account (console.log(self.system()) from widget/script.js,
// same method already used to confirm TAG_RULES in the teg_paint widget),
// then verify it here instead of/in addition to the tokenStore lookup.
function verifyWidgetSignature({ accountId, subdomain }) {
  if (!accountId || !subdomain) {
    return false;
  }
  const account = tokenStore.getAccount(Number(accountId));
  return Boolean(account) && account.subdomain === subdomain;
}

function issueSessionToken({ accountId, subdomain }) {
  return jwt.sign({ accountId, subdomain }, process.env.SESSION_JWT_SECRET, {
    expiresIn: SESSION_TOKEN_TTL_SECONDS
  });
}

const LOGIN_COOKIE_NAME = 'la_login';
const LOGIN_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30d

// The standalone /dashboard page (see routes/dashboard.js) isn't opened
// from inside an authenticated amoCRM session, so unlike the iframe path
// above there's no amoCRM-side fact to lean on at all — a shared password
// is the only gate. Keep this login separate from the amoCRM OAuth tokens:
// it only proves "this browser knows the dashboard password", nothing more.
function issueLoginToken() {
  return jwt.sign({ type: 'dashboard_login' }, process.env.SESSION_JWT_SECRET, {
    expiresIn: LOGIN_TOKEN_TTL_SECONDS
  });
}

function requireDashboardLogin(req, res, next) {
  const token = req.cookies && req.cookies[LOGIN_COOKIE_NAME];
  if (!token) {
    res.redirect('/dashboard/login');
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.SESSION_JWT_SECRET);
    if (payload.type !== 'dashboard_login') throw new Error('wrong_token_type');
    next();
  } catch (err) {
    res.redirect('/dashboard/login');
  }
}

function requireSession(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'missing_session_token' });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.SESSION_JWT_SECRET);
    req.session = { accountId: payload.accountId, subdomain: payload.subdomain };
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid_session_token' });
  }
}

module.exports = {
  verifyWidgetSignature,
  issueSessionToken,
  requireSession,
  issueLoginToken,
  requireDashboardLogin,
  LOGIN_COOKIE_NAME
};
