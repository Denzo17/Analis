const db = require('../db');

const upsertStmt = db.prepare(`
  INSERT INTO accounts (account_id, subdomain, access_token, refresh_token, expires_at, created_at, updated_at)
  VALUES (@account_id, @subdomain, @access_token, @refresh_token, @expires_at, @now, @now)
  ON CONFLICT(account_id) DO UPDATE SET
    subdomain = excluded.subdomain,
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at
`);

const getStmt = db.prepare('SELECT * FROM accounts WHERE account_id = ?');

function saveTokens(accountId, subdomain, { accessToken, refreshToken, expiresIn }) {
  const now = Math.floor(Date.now() / 1000);
  upsertStmt.run({
    account_id: accountId,
    subdomain,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: now + expiresIn,
    now
  });
}

function getAccount(accountId) {
  return getStmt.get(accountId);
}

module.exports = { saveTokens, getAccount };
