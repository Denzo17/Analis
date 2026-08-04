const db = require('../db');

// Keyed by the exact date range, per the account's own workflow: pick a
// period, type in what was spent on ads for that period, and it's recalled
// next time that same period is selected. A different range starts blank.
const getStmt = db.prepare(
  'SELECT amount FROM marketing_spend WHERE account_id = ? AND pipeline_id = ? AND date_from = ? AND date_to = ?'
);
const upsertStmt = db.prepare(`
  INSERT INTO marketing_spend (account_id, pipeline_id, date_from, date_to, amount, updated_at)
  VALUES (@account_id, @pipeline_id, @date_from, @date_to, @amount, @now)
  ON CONFLICT(account_id, pipeline_id, date_from, date_to) DO UPDATE SET
    amount = excluded.amount,
    updated_at = excluded.updated_at
`);

function getSpend(accountId, pipelineId, dateFrom, dateTo) {
  const row = getStmt.get(accountId, pipelineId, dateFrom, dateTo);
  return row ? row.amount : 0;
}

function saveSpend(accountId, pipelineId, dateFrom, dateTo, amount) {
  upsertStmt.run({
    account_id: accountId,
    pipeline_id: pipelineId,
    date_from: dateFrom,
    date_to: dateTo,
    amount,
    now: Math.floor(Date.now() / 1000)
  });
  return amount;
}

module.exports = { getSpend, saveSpend };
