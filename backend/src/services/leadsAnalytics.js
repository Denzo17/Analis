const amocrm = require('./amocrmClient');

const WON_STATUS_ID = 142;
const LOST_STATUS_ID = 143;
const PAGE_LIMIT = 250;
const MAX_PAGES = 200; // safety cap (~50k leads) so a huge account can't hang a request

async function fetchPipelines(accountId) {
  const data = await amocrm.apiRequest(accountId, '/api/v4/leads/pipelines');
  const pipelines = (data && data._embedded && data._embedded.pipelines) || [];
  return pipelines.map((p) => ({
    id: p.id,
    name: p.name,
    statuses: ((p._embedded && p._embedded.statuses) || [])
      .map((s) => ({ id: s.id, name: s.name, sort: s.sort, color: s.color }))
      .sort((a, b) => a.sort - b.sort)
  }));
}

async function fetchUsers(accountId) {
  const data = await amocrm.apiRequest(accountId, '/api/v4/users', { query: { limit: 250 } });
  const users = (data && data._embedded && data._embedded.users) || [];
  return users.map((u) => ({ id: u.id, name: u.name }));
}

// Digital-pipeline lead sources (site forms, telephony, chats, ...). Accounts
// without digital pipeline enabled don't have this endpoint — treat as empty
// rather than failing the whole dashboard.
async function fetchSources(accountId) {
  try {
    const data = await amocrm.apiRequest(accountId, '/api/v4/sources');
    const sources = (data && data._embedded && data._embedded.sources) || [];
    return sources.map((s) => ({ id: s.id, name: s.name }));
  } catch (err) {
    return [];
  }
}

// amoCRM gives UTM fields a stable field_code (UTM_CAMPAIGN, UTM_SOURCE, …)
// when digital pipeline tracking is on, regardless of what the account
// renamed the field to — match on that first, and fall back to matching the
// field's display name in case it's a plain custom field someone created
// by hand instead.
async function fetchLeadCustomFields(accountId) {
  const data = await amocrm.apiRequest(accountId, '/api/v4/leads/custom_fields', { query: { limit: 250 } });
  const fields = (data && data._embedded && data._embedded.custom_fields) || [];
  return fields.map((f) => ({ id: f.id, name: f.name, code: f.code }));
}

function findFieldId(customFields, { code, name }) {
  if (code) {
    const byCode = customFields.find((f) => f.code === code);
    if (byCode) return byCode.id;
  }
  if (name) {
    const normalized = name.toLowerCase().trim();
    const byName = customFields.find((f) => String(f.name || '').toLowerCase().trim() === normalized);
    if (byName) return byName.id;
  }
  return null;
}

function findUtmCampaignFieldId(customFields) {
  return findFieldId(customFields, { code: 'UTM_CAMPAIGN', name: 'utm_campaign' });
}

function findUtmSourceFieldId(customFields) {
  return findFieldId(customFields, { code: 'UTM_SOURCE', name: 'utm_source' });
}

// "Источник клиента" isn't a standardized amoCRM field (no field_code for
// it) — it's a plain custom field this account created, so name-matching is
// the only option. If the account ever renames it, this lookup needs the
// new name too.
function findClientSourceFieldId(customFields) {
  return findFieldId(customFields, { name: 'Источник клиента' });
}

function getCustomFieldValue(lead, fieldId) {
  if (!fieldId) return null;
  const values = lead.custom_fields_values;
  if (!values) return null;
  const field = values.find((f) => f.field_id === fieldId);
  if (!field || !field.values || !field.values.length) return null;
  return field.values[0].value || null;
}

async function fetchLeadsInRange(accountId, { pipelineId, dateFrom, dateTo }) {
  const leads = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = {
      limit: PAGE_LIMIT,
      page,
      with: 'source,loss_reason',
      'filter[pipeline_id]': pipelineId
    };
    if (dateFrom) query['filter[created_at][from]'] = dateFrom;
    if (dateTo) query['filter[created_at][to]'] = dateTo;

    const data = await amocrm.apiRequest(accountId, '/api/v4/leads', { query });
    const batch = (data && data._embedded && data._embedded.leads) || [];
    leads.push(...batch);
    if (!data || !data._links || !data._links.next) {
      break;
    }
  }
  return leads;
}

function buildStageOrder(statuses) {
  const regular = statuses
    .filter((s) => s.id !== WON_STATUS_ID && s.id !== LOST_STATUS_ID)
    .sort((a, b) => a.sort - b.sort);
  const order = new Map();
  regular.forEach((s, i) => order.set(s.id, i));
  return order;
}

// A lead "reached" a given stage if it's currently sitting there or later in
// the pipeline's order, or already won (won implies every earlier stage was
// passed). Lost leads don't retain which stage they were in before closing
// without pulling per-lead event history, which is too expensive to do for
// a whole account on every dashboard load — so lost leads count only toward
// "new" and "lost", never toward "reached key/sale stage".
function reachedStage(lead, targetStatusId, stageOrder) {
  if (targetStatusId == null) return false;
  if (lead.status_id === LOST_STATUS_ID) return false;
  if (lead.status_id === WON_STATUS_ID) return true;
  if (lead.status_id === targetStatusId) return true;
  const leadIdx = stageOrder.get(lead.status_id);
  const targetIdx = stageOrder.get(targetStatusId);
  if (leadIdx === undefined || targetIdx === undefined) return false;
  return leadIdx >= targetIdx;
}

function rate(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100; // 2 decimal places
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Used only to pick out the "Заявка с сайта" branch for the top KPI tiles
// (a convenience summary) — every tree node gets its own editable spend now,
// not just this one, see buildGroupTree.
const SITE_LEAD_SOURCE_LABEL = 'Заявка с сайта';

function isSiteLeadSourceLabel(label) {
  return String(label || '').trim().toLowerCase() === SITE_LEAD_SOURCE_LABEL.toLowerCase();
}

function filterLeads(leads, { managerIds, sourceIds, utmCampaigns, utmFieldId }) {
  return leads.filter((lead) => {
    if (managerIds && managerIds.length && !managerIds.includes(lead.responsible_user_id)) {
      return false;
    }
    if (sourceIds && sourceIds.length) {
      const sourceId = lead._embedded && lead._embedded.source ? lead._embedded.source.id : null;
      if (!sourceId || !sourceIds.includes(sourceId)) {
        return false;
      }
    }
    if (utmCampaigns && utmCampaigns.length) {
      const value = getCustomFieldValue(lead, utmFieldId);
      if (!value || !utmCampaigns.includes(value)) {
        return false;
      }
    }
    return true;
  });
}

// Filter dropdown options are derived from the leads actually loaded for the
// current pipeline/date range rather than a separate catalog call — amoCRM's
// /api/v4/sources catalog is frequently empty even when leads carry a source
// name (it only lists formally configured digital-pipeline sources), and
// there's no catalog endpoint for UTM campaign values at all.
function buildFilterOptions(leads, utmFieldId) {
  const sourcesById = new Map();
  const utmCampaigns = new Set();
  leads.forEach((lead) => {
    const source = lead._embedded && lead._embedded.source;
    if (source && source.id && !sourcesById.has(source.id)) {
      sourcesById.set(source.id, source.name || `#${source.id}`);
    }
    const utmValue = getCustomFieldValue(lead, utmFieldId);
    if (utmValue) utmCampaigns.add(utmValue);
  });
  return {
    sources: Array.from(sourcesById.entries()).map(([id, name]) => ({ id, name })),
    utmCampaigns: Array.from(utmCampaigns.values()).sort()
  };
}

function summarizeGroup(leads, keyStageId, saleStageId, stageOrder) {
  const newCount = leads.length;
  const keyCount = leads.filter((l) => reachedStage(l, keyStageId, stageOrder)).length;
  const saleCount = leads.filter((l) => reachedStage(l, saleStageId, stageOrder)).length;
  const wonCount = leads.filter((l) => l.status_id === WON_STATUS_ID).length;
  const lostCount = leads.filter((l) => l.status_id === LOST_STATUS_ID).length;
  const inProgressCount = newCount - wonCount - lostCount;

  return {
    newCount,
    keyCount,
    saleCount,
    wonCount,
    lostCount,
    inProgressCount,
    newToKeyRate: rate(keyCount, newCount),
    keyToSaleRate: rate(saleCount, keyCount),
    newToSaleRate: rate(saleCount, newCount)
  };
}

// Groups `leads` by levels[0]'s field value, then recurses into each
// resulting bucket for levels[1], etc. — building the "Источник клиента →
// utm_source → utm_campaign" drill-down tree. Each node carries the same
// stats as the flat per-manager table so every level of the tree is
// readable on its own, not just the leaves.
//
// Every node also gets its own editable spend figure (spendByPath, keyed by
// the same '›'-joined path the frontend displays/edits), and cpl/cac
// computed from that node's own spend and its own newCount/saleCount — a
// real per-node number now that spend isn't a single account-wide figure.
function buildGroupTree(leads, levels, levelIndex, keyStageId, saleStageId, stageOrder, spendByPath, parentPath) {
  if (levelIndex >= levels.length) return null;
  const level = levels[levelIndex];
  const groups = new Map();
  leads.forEach((lead) => {
    const value = getCustomFieldValue(lead, level.fieldId) || level.emptyLabel;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(lead);
  });
  return Array.from(groups.entries())
    .map(([label, groupLeads]) => {
      const path = parentPath ? `${parentPath}›${label}` : label;
      const stats = summarizeGroup(groupLeads, keyStageId, saleStageId, stageOrder);
      const spend = Object.prototype.hasOwnProperty.call(spendByPath, path) ? spendByPath[path] : null;
      return {
        label,
        path,
        ...stats,
        spend,
        cpl: spend && stats.newCount ? round2(spend / stats.newCount) : null,
        cac: spend && stats.saleCount ? round2(spend / stats.saleCount) : null,
        children: buildGroupTree(groupLeads, levels, levelIndex + 1, keyStageId, saleStageId, stageOrder, spendByPath, path)
      };
    })
    .sort((a, b) => b.newCount - a.newCount);
}

function buildDashboard({
  leads,
  statuses,
  users,
  keyStageId,
  saleStageId,
  filters,
  utmFieldId,
  utmSourceFieldId,
  clientSourceFieldId,
  spendByPath
}) {
  const stageOrder = buildStageOrder(statuses);
  const filterOptions = buildFilterOptions(leads, utmFieldId);
  const filtered = filterLeads(leads, { ...(filters || {}), utmFieldId });

  const overall = summarizeGroup(filtered, keyStageId, saleStageId, stageOrder);

  const byManager = new Map();
  filtered.forEach((lead) => {
    const id = lead.responsible_user_id;
    if (!byManager.has(id)) byManager.set(id, []);
    byManager.get(id).push(lead);
  });

  const userNameById = new Map(users.map((u) => [u.id, u.name]));
  const managerBreakdown = Array.from(byManager.entries())
    .map(([userId, userLeads]) => ({
      userId,
      userName: userNameById.get(userId) || `#${userId}`,
      ...summarizeGroup(userLeads, keyStageId, saleStageId, stageOrder)
    }))
    .sort((a, b) => b.newCount - a.newCount);

  const sourceTreeLevels = [
    { fieldId: clientSourceFieldId, emptyLabel: '(не указан источник)' },
    { fieldId: utmSourceFieldId, emptyLabel: '(без utm_source)' },
    { fieldId: utmFieldId, emptyLabel: '(без utm_campaign)' }
  ];
  const sourceTree = buildGroupTree(filtered, sourceTreeLevels, 0, keyStageId, saleStageId, stageOrder, spendByPath || {}, '');

  const siteLeadNode = sourceTree.find((node) => isSiteLeadSourceLabel(node.label));
  const cost = {
    spend: siteLeadNode ? siteLeadNode.spend || 0 : 0,
    newCount: siteLeadNode ? siteLeadNode.newCount : 0,
    saleCount: siteLeadNode ? siteLeadNode.saleCount : 0,
    cpl: siteLeadNode ? siteLeadNode.cpl : null,
    cac: siteLeadNode ? siteLeadNode.cac : null
  };

  const lossReasonCounts = new Map();
  filtered.forEach((lead) => {
    if (lead.status_id !== LOST_STATUS_ID) return;
    const reason = (lead._embedded && lead._embedded.loss_reason && lead._embedded.loss_reason.name) || '(без причины)';
    lossReasonCounts.set(reason, (lossReasonCounts.get(reason) || 0) + 1);
  });
  const lossReasons = Array.from(lossReasonCounts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const statusNameById = new Map(statuses.map((s) => [s.id, s.name]));
  const dealsInProgress = filtered
    .filter((l) => l.status_id !== WON_STATUS_ID && l.status_id !== LOST_STATUS_ID)
    .sort((a, b) => b.created_at - a.created_at)
    .map((l) => ({
      id: l.id,
      name: l.name,
      responsibleUserId: l.responsible_user_id,
      responsibleUserName: userNameById.get(l.responsible_user_id) || '',
      statusId: l.status_id,
      statusName: statusNameById.get(l.status_id) || '',
      sourceName: (l._embedded && l._embedded.source && l._embedded.source.name) || '',
      utmCampaign: getCustomFieldValue(l, utmFieldId) || '',
      createdAt: l.created_at,
      price: l.price || 0
    }));

  return { overall, managerBreakdown, sourceTree, dealsInProgress, filterOptions, cost, lossReasons };
}

module.exports = {
  SITE_LEAD_SOURCE_LABEL,
  fetchPipelines,
  fetchUsers,
  fetchSources,
  fetchLeadCustomFields,
  findUtmCampaignFieldId,
  findUtmSourceFieldId,
  findClientSourceFieldId,
  fetchLeadsInRange,
  buildDashboard,
  WON_STATUS_ID,
  LOST_STATUS_ID
};
