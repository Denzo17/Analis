const db = require('../db');

// Keyed by the exact date range + the tree node's own path (e.g. "Заявка с
// сайта" or "Заявка с сайта›yandex›summer") — each source/utm_source/
// utm_campaign row gets its own spend figure for a given period, recalled
// next time that same period is selected.
const getMapStmt = db.prepare(
  'SELECT node_path, amount FROM marketing_spend WHERE account_id = ? AND pipeline_id = ? AND date_from = ? AND date_to = ?'
);
const upsertStmt = db.prepare(`
  INSERT INTO marketing_spend (account_id, pipeline_id, date_from, date_to, node_path, amount, updated_at)
  VALUES (@account_id, @pipeline_id, @date_from, @date_to, @node_path, @amount, @now)
  ON CONFLICT(account_id, pipeline_id, date_from, date_to, node_path) DO UPDATE SET
    amount = excluded.amount,
    updated_at = excluded.updated_at
`);

function getSpendMap(accountId, pipelineId, dateFrom, dateTo) {
  const rows = getMapStmt.all(accountId, pipelineId, dateFrom, dateTo);
  const map = {};
  rows.forEach((row) => { map[row.node_path] = row.amount; });
  return map;
}

function saveSpend(accountId, pipelineId, dateFrom, dateTo, nodePath, amount) {
  upsertStmt.run({
    account_id: accountId,
    pipeline_id: pipelineId,
    date_from: dateFrom,
    date_to: dateTo,
    node_path: nodePath,
    amount,
    now: Math.floor(Date.now() / 1000)
  });
  return amount;
}

module.exports = { getSpendMap, saveSpend };
