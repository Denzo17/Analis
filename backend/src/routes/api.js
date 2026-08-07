const express = require('express');
const { requireSession } = require('../middleware/session');
const analytics = require('../services/leadsAnalytics');
const settingsStore = require('../services/settingsStore');
const marketingSpendStore = require('../services/marketingSpendStore');
const reportExport = require('../services/reportExport');

const router = express.Router();
router.use(requireSession);

function parseIdList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));
}

function parseStringList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Shared by /dashboard/summary and /dashboard/export so both build the
// exact same numbers from the exact same filters — the export route should
// never drift from what the dashboard actually shows.
async function loadDashboardData(accountId, query) {
  const pipelineId = Number(query.pipelineId);
  if (!pipelineId) {
    const err = new Error('pipelineId_required');
    err.code = 'pipelineId_required';
    err.status = 400;
    throw err;
  }

  const settings = settingsStore.getSettings(accountId, pipelineId);
  if (!settings.keyStageId || !settings.saleStageId) {
    const err = new Error('stages_not_configured');
    err.code = 'stages_not_configured';
    err.status = 409;
    err.settings = settings;
    throw err;
  }

  const { dateFrom, dateTo, managerIds, sourceIds, utmCampaigns } = query;
  const dateFromNum = dateFrom ? Math.floor(Number(dateFrom)) : undefined;
  const dateToNum = dateTo ? Math.floor(Number(dateTo)) : undefined;

  const [pipelines, users, leads, customFields] = await Promise.all([
    analytics.fetchPipelines(accountId),
    analytics.fetchUsers(accountId),
    analytics.fetchLeadsInRange(accountId, { pipelineId, dateFrom: dateFromNum, dateTo: dateToNum }),
    analytics.fetchLeadCustomFields(accountId).catch(() => [])
  ]);

  const pipeline = pipelines.find((p) => p.id === pipelineId);
  if (!pipeline) {
    const err = new Error('pipeline_not_found');
    err.code = 'pipeline_not_found';
    err.status = 404;
    throw err;
  }

  const utmFieldId = analytics.findUtmCampaignFieldId(customFields);
  const utmSourceFieldId = analytics.findUtmSourceFieldId(customFields);
  const clientSourceFieldId = analytics.findClientSourceFieldId(customFields);
  const spendByPath = dateFromNum && dateToNum
    ? marketingSpendStore.getSpendMap(accountId, pipelineId, dateFromNum, dateToNum)
    : {};
  const filtersObj = {
    managerIds: parseIdList(managerIds),
    sourceIds: parseIdList(sourceIds),
    utmCampaigns: parseStringList(utmCampaigns)
  };

  const dashboard = analytics.buildDashboard({
    leads,
    statuses: pipeline.statuses,
    users,
    keyStageId: settings.keyStageId,
    saleStageId: settings.saleStageId,
    utmFieldId,
    utmSourceFieldId,
    clientSourceFieldId,
    spendByPath,
    filters: filtersObj
  });

  const stageOrder = analytics.buildStageOrder(pipeline.statuses);
  const avgCycle = await analytics.computeAvgSaleCycleDaysClosedInPeriod(accountId, {
    saleStageId: settings.saleStageId,
    stageOrder,
    dateFrom: dateFromNum,
    dateTo: dateToNum,
    filters: filtersObj,
    utmFieldId,
    users,
    statuses: pipeline.statuses
  });

  const payload = {
    pipeline: { id: pipeline.id, name: pipeline.name, statuses: pipeline.statuses },
    settings,
    ...dashboard,
    avgSaleCycleDays: avgCycle.avgDays,
    avgSaleCycleDeals: avgCycle.deals
  };

  return { payload, users, filtersObj, dateFromNum, dateToNum };
}

function formatPeriodLabel(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return '';
  const f = new Date(dateFrom * 1000).toLocaleDateString('ru-RU');
  const t = new Date(dateTo * 1000).toLocaleDateString('ru-RU');
  return f + ' — ' + t;
}

router.get('/filters/options', async (req, res) => {
  try {
    const { accountId } = req.session;
    const [pipelines, users, sources] = await Promise.all([
      analytics.fetchPipelines(accountId),
      analytics.fetchUsers(accountId),
      analytics.fetchSources(accountId)
    ]);
    res.json({ pipelines, users, sources });
  } catch (err) {
    console.error('GET /filters/options failed', err);
    res.status(502).json({ error: 'amocrm_request_failed', message: err.message });
  }
});

router.get('/settings', (req, res) => {
  const { accountId } = req.session;
  const pipelineId = Number(req.query.pipelineId);
  if (!pipelineId) {
    res.status(400).json({ error: 'pipelineId_required' });
    return;
  }
  res.json(settingsStore.getSettings(accountId, pipelineId));
});

router.post('/settings', (req, res) => {
  const { accountId } = req.session;
  const { pipelineId, keyStageId, saleStageId, design, filters } = req.body || {};
  if (!pipelineId) {
    res.status(400).json({ error: 'pipelineId_required' });
    return;
  }
  const saved = settingsStore.saveSettings(accountId, pipelineId, { keyStageId, saleStageId, design, filters });
  res.json(saved);
});

router.post('/marketing-spend', (req, res) => {
  const { accountId } = req.session;
  const { pipelineId, dateFrom, dateTo, path, amount } = req.body || {};
  const pipelineIdNum = Number(pipelineId);
  const dateFromNum = Math.floor(Number(dateFrom));
  const dateToNum = Math.floor(Number(dateTo));
  const amountNum = Number(amount);
  if (
    !pipelineIdNum ||
    !Number.isFinite(dateFromNum) ||
    !Number.isFinite(dateToNum) ||
    !path ||
    !Number.isFinite(amountNum) ||
    amountNum < 0
  ) {
    res.status(400).json({ error: 'invalid_params' });
    return;
  }
  marketingSpendStore.saveSpend(accountId, pipelineIdNum, dateFromNum, dateToNum, String(path), amountNum);
  res.json({ amount: amountNum });
});

router.get('/dashboard/summary', async (req, res) => {
  try {
    const { accountId } = req.session;
    const { payload } = await loadDashboardData(accountId, req.query);
    res.json(payload);
  } catch (err) {
    if (err.status) {
      res.status(err.status).json({ error: err.code, settings: err.settings });
      return;
    }
    console.error('GET /dashboard/summary failed', err);
    res.status(502).json({ error: 'amocrm_request_failed', message: err.message });
  }
});

router.get('/dashboard/export', async (req, res) => {
  try {
    const format = String(req.query.format || '').toLowerCase();
    if (format !== 'pdf' && format !== 'xlsx') {
      res.status(400).json({ error: 'invalid_format' });
      return;
    }

    const { accountId } = req.session;
    const { payload, users, filtersObj, dateFromNum, dateToNum } = await loadDashboardData(accountId, req.query);

    const userNameById = new Map(users.map((u) => [u.id, u.name]));
    const sourceNameById = new Map((payload.filterOptions.sources || []).map((s) => [s.id, s.name]));
    const meta = {
      periodLabel: formatPeriodLabel(dateFromNum, dateToNum),
      managerNames: filtersObj.managerIds.map((id) => userNameById.get(id) || ('#' + id)),
      sourceNames: filtersObj.sourceIds.map((id) => sourceNameById.get(id) || ('#' + id)),
      utmCampaigns: filtersObj.utmCampaigns
    };

    const model = reportExport.buildReportModel(payload, meta);
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (format === 'pdf') {
      const buffer = await reportExport.generatePdf(model);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="report_${dateStamp}.pdf"`);
      res.send(buffer);
    } else {
      const buffer = await reportExport.generateXlsx(model);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="report_${dateStamp}.xlsx"`);
      res.send(buffer);
    }
  } catch (err) {
    if (err.status) {
      res.status(err.status).json({ error: err.code });
      return;
    }
    console.error('GET /dashboard/export failed', err);
    res.status(502).json({ error: 'export_failed', message: err.message });
  }
});

module.exports = router;
