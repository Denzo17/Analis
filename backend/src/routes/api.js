const express = require('express');
const { requireSession } = require('../middleware/session');
const analytics = require('../services/leadsAnalytics');
const settingsStore = require('../services/settingsStore');
const marketingSpendStore = require('../services/marketingSpendStore');

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
    const pipelineId = Number(req.query.pipelineId);
    if (!pipelineId) {
      res.status(400).json({ error: 'pipelineId_required' });
      return;
    }

    const settings = settingsStore.getSettings(accountId, pipelineId);
    if (!settings.keyStageId || !settings.saleStageId) {
      res.status(409).json({ error: 'stages_not_configured', settings });
      return;
    }

    const { dateFrom, dateTo, managerIds, sourceIds, utmCampaigns } = req.query;
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
      res.status(404).json({ error: 'pipeline_not_found' });
      return;
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

    res.json({
      pipeline: { id: pipeline.id, name: pipeline.name, statuses: pipeline.statuses },
      settings,
      ...dashboard,
      avgSaleCycleDays: avgCycle.avgDays,
      avgSaleCycleDeals: avgCycle.deals
    });
  } catch (err) {
    console.error('GET /dashboard/summary failed', err);
    res.status(502).json({ error: 'amocrm_request_failed', message: err.message });
  }
});

module.exports = router;
