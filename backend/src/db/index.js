const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/app.sqlite';
// This file holds live amoCRM OAuth tokens in plaintext — restrict it to
// the app's own OS user (0700/0600) so it isn't readable by other local
// accounts on a shared box, on top of never being served over HTTP.
fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
try {
  fs.chmodSync(dbPath, 0o600);
} catch (err) {
  // best-effort — file may not exist yet on a brand-new DB in some
  // better-sqlite3 versions until the first write
}

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    account_id    INTEGER PRIMARY KEY,
    subdomain     TEXT NOT NULL,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dashboard_settings (
    account_id      INTEGER NOT NULL,
    pipeline_id     INTEGER NOT NULL,
    key_stage_id    INTEGER,
    sale_stage_id   INTEGER,
    design_json     TEXT NOT NULL DEFAULT '{}',
    filters_json    TEXT NOT NULL DEFAULT '{}',
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (account_id, pipeline_id),
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS marketing_spend (
    account_id    INTEGER NOT NULL,
    pipeline_id   INTEGER NOT NULL,
    date_from     INTEGER NOT NULL,
    date_to       INTEGER NOT NULL,
    amount        REAL NOT NULL,
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (account_id, pipeline_id, date_from, date_to),
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
  );
`);

module.exports = db;
