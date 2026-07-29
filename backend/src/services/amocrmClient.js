const fetch = require('node-fetch');
const tokenStore = require('./tokenStore');

const CLIENT_ID = process.env.AMO_CLIENT_ID;
const CLIENT_SECRET = process.env.AMO_CLIENT_SECRET;
const REDIRECT_URI = process.env.AMO_REDIRECT_URI;

async function exchangeCodeForTokens(subdomain, code) {
  return requestTokens(subdomain, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI
  });
}

async function refreshTokens(subdomain, refreshToken) {
  return requestTokens(subdomain, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    redirect_uri: REDIRECT_URI
  });
}

async function requestTokens(subdomain, body) {
  const res = await fetch(`https://${subdomain}.amocrm.ru/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`amoCRM OAuth error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in
  };
}

// Returns a valid access token for the account, refreshing it first if it's
// expired (or close to it) — amoCRM access tokens are short-lived.
async function getValidAccessToken(accountId) {
  const account = tokenStore.getAccount(accountId);
  if (!account) {
    throw new Error(`No stored amoCRM tokens for account ${accountId}`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (account.expires_at - now > 60) {
    return { accessToken: account.access_token, subdomain: account.subdomain };
  }
  const tokens = await refreshTokens(account.subdomain, account.refresh_token);
  tokenStore.saveTokens(accountId, account.subdomain, tokens);
  return { accessToken: tokens.accessToken, subdomain: account.subdomain };
}

// Thin wrapper around a single amoCRM API v4 call with auto token refresh.
async function apiRequest(accountId, path, { method = 'GET', query, body } = {}) {
  const { accessToken, subdomain } = await getValidAccessToken(accountId);
  const url = new URL(`https://${subdomain}.amocrm.ru${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        value.forEach((v, i) => url.searchParams.append(`${key}[${i}]`, v));
      } else if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) {
    return null;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`amoCRM API ${method} ${path} -> ${res.status}: ${text}`);
  }
  return res.json();
}

module.exports = { exchangeCodeForTokens, refreshTokens, getValidAccessToken, apiRequest };
