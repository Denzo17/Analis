const db = require('../db');

const DEFAULT_DESIGN = {
  accentColor: '#2E6BE6',
  visibleTiles: ['new_leads', 'key_stage', 'key_stage_rate', 'sale', 'sale_rate_from_key', 'sale_rate_from_new', 'cost_per_lead', 'cost_per_sale', 'avg_check'],
  visibleBottomTiles: ['avg_sale_cycle', 'sale_fact', 'sale_fact_amount', 'avg_check'],
  showManagerTable: true,
  showSourceTree: true,
  showFunnelChart: true,
  showDealsInProgress: true,
  showDealsLost: true,
  showDealsWon: true,
  showAvgSaleCycleDeals: true
};

const getStmt = db.prepare('SELECT * FROM dashboard_settings WHERE account_id = ? AND pipeline_id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO dashboard_settings (account_id, pipeline_id, key_stage_id, sale_stage_id, design_json, filters_json, updated_at)
  VALUES (@account_id, @pipeline_id, @key_stage_id, @sale_stage_id, @design_json, @filters_json, @now)
  ON CONFLICT(account_id, pipeline_id) DO UPDATE SET
    key_stage_id = excluded.key_stage_id,
    sale_stage_id = excluded.sale_stage_id,
    design_json = excluded.design_json,
    filters_json = excluded.filters_json,
    updated_at = excluded.updated_at
`);

function getSettings(accountId, pipelineId) {
  const row = getStmt.get(accountId, pipelineId);
  if (!row) {
    return {
      accountId,
      pipelineId,
      keyStageId: null,
      saleStageId: null,
      design: DEFAULT_DESIGN,
      filters: {}
    };
  }
  return {
    accountId,
    pipelineId,
    keyStageId: row.key_stage_id,
    saleStageId: row.sale_stage_id,
    design: { ...DEFAULT_DESIGN, ...JSON.parse(row.design_json || '{}') },
    filters: JSON.parse(row.filters_json || '{}')
  };
}

function saveSettings(accountId, pipelineId, { keyStageId, saleStageId, design, filters }) {
  upsertStmt.run({
    account_id: accountId,
    pipeline_id: pipelineId,
    key_stage_id: keyStageId ?? null,
    sale_stage_id: saleStageId ?? null,
    design_json: JSON.stringify(design || {}),
    filters_json: JSON.stringify(filters || {}),
    now: Math.floor(Date.now() / 1000)
  });
  return getSettings(accountId, pipelineId);
}

module.exports = { getSettings, saveSettings, DEFAULT_DESIGN };
