const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/app.sqlite';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
`);

module.exports = db;
