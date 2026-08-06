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

// amoCRM's `with=loss_reason` embed comes back as an array
// (`_embedded.loss_reason: [{id, name}]`), not a single object like
// `_embedded.source` — reading `.name` straight off it silently returns
// undefined for every lead, which is exactly why every lost lead was
// showing up as "(без причины)" regardless of what was actually set in
// amoCRM. Handle both shapes defensively in case that ever changes.
function getLossReasonName(lead) {
  const raw = lead._embedded && lead._embedded.loss_reason;
  if (!raw) return null;
  const reason = Array.isArray(raw) ? raw[0] : raw;
  return (reason && reason.name) || null;
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

const EVENT_PAGE_LIMIT = 250;
const MAX_EVENT_PAGES = 50;
const ID_BATCH_SIZE = 50; // ids per request (query-string size headroom)

// Every lead_status_changed event across the whole account within a date
// range, regardless of which lead it belongs to — used to find leads that
// crossed into the sale stage *during this period*, even if they were
// created long before it. Not scoped by pipeline in the request itself:
// amoCRM status ids are unique per pipeline account-wide, so matching a
// specific pipeline's saleStageId (via reachedStage against that pipeline's
// own stageOrder) already excludes every other pipeline's events without an
// extra filter.
async function fetchStatusChangeEventsInRange(accountId, { dateFrom, dateTo }) {
  const events = [];
  for (let page = 1; page <= MAX_EVENT_PAGES; page += 1) {
    const query = {
      limit: EVENT_PAGE_LIMIT,
      page,
      'filter[type]': 'lead_status_changed',
      'filter[entity]': 'lead'
    };
    if (dateFrom) query['filter[created_at][from]'] = dateFrom;
    if (dateTo) query['filter[created_at][to]'] = dateTo;
    const data = await amocrm.apiRequest(accountId, '/api/v4/events', { query });
    const batch = (data && data._embedded && data._embedded.events) || [];
    events.push(...batch);
    if (!data || !data._links || !data._links.next) {
      break;
    }
  }
  return events;
}

// Batched lookup for specific lead ids (the candidates found via events
// above) — we need their created_at/responsible_user_id/source/utm to
// compute cycle length and apply the current manager/source/utm filters,
// and these leads generally aren't in the period-filtered `leads` array
// this dashboard load already has (they can predate the selected period).
async function fetchLeadsByIds(accountId, leadIds) {
  const leads = [];
  for (let i = 0; i < leadIds.length; i += ID_BATCH_SIZE) {
    const chunk = leadIds.slice(i, i + ID_BATCH_SIZE);
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = {
        limit: PAGE_LIMIT,
        page,
        with: 'source',
        'filter[id]': chunk
      };
      const data = await amocrm.apiRequest(accountId, '/api/v4/leads', { query });
      const batch = (data && data._embedded && data._embedded.leads) || [];
      leads.push(...batch);
      if (!data || !data._links || !data._links.next) {
        break;
      }
    }
  }
  return leads;
}

// amoCRM's event value_after for a status change is documented as an array
// (mirrors value_before) — defensively also accept a bare object in case
// that ever changes, same approach as getLossReasonName above.
function extractStatusIdFromEvent(event) {
  const after = event && event.value_after;
  if (!after) return null;
  const list = Array.isArray(after) ? after : [after];
  for (const item of list) {
    const status = item && (item.lead_status || item.status);
    if (status && status.id != null) return status.id;
  }
  return null;
}

// Average number of days between a lead's creation and the moment it
// crossed into saleStageId — but the cohort here is "leads that crossed
// into the sale stage during the selected period", not "leads created
// during the selected period". A deal created 05.06 and closed 10.07 has a
// 35-day cycle and shows up when the period filter is set to July (when it
// closed), not June (when it started) — matches how the rest of the
// dashboard's "Продажи" count would NOT include it for a June-period
// filter (it was created in June but the dashboard only knows about leads
// created within the selected range), while this tile intentionally covers
// a different, closing-date-based question.
//
// Because of that this can't reuse the period-filtered `leads` list this
// dashboard load already has — a lead closing this period may have been
// created in an earlier one and never fetched. So: find every
// lead_status_changed event account-wide in [dateFrom, dateTo] whose new
// status counts as "reached" saleStageId (same stage-order comparison as
// reachedStage() — a lead can jump straight past saleStageId in one drag,
// e.g. A -> C skipping B, so exact-id matching would miss it), take each
// lead's earliest such event in the period, then fetch just those leads to
// get created_at and apply the current manager/source/utm filters.
async function computeAvgSaleCycleDaysClosedInPeriod(accountId, {
  saleStageId,
  stageOrder,
  dateFrom,
  dateTo,
  filters,
  utmFieldId
}) {
  if (!saleStageId || !stageOrder) return null;

  const events = await fetchStatusChangeEventsInRange(accountId, { dateFrom, dateTo });

  const firstReachedAt = new Map();
  events.forEach((event) => {
    const extracted = extractStatusIdFromEvent(event);
    const counts = extracted != null && reachedStage({ status_id: extracted }, saleStageId, stageOrder);
    if (!counts) return;
    const leadId = event.entity_id;
    const ts = event.created_at;
    const existing = firstReachedAt.get(leadId);
    if (existing === undefined || ts < existing) {
      firstReachedAt.set(leadId, ts);
    }
  });

  if (!firstReachedAt.size) return null;

  const candidateLeads = await fetchLeadsByIds(accountId, Array.from(firstReachedAt.keys()));
  const filteredCandidates = filterLeads(candidateLeads, { ...(filters || {}), utmFieldId });

  const durationsInDays = [];
  filteredCandidates.forEach((lead) => {
    const reachedAt = firstReachedAt.get(lead.id);
    if (reachedAt == null) return;
    const days = (reachedAt - lead.created_at) / 86400;
    if (days >= 0) durationsInDays.push(days);
  });

  if (!durationsInDays.length) return null;
  const avg = durationsInDays.reduce((a, b) => a + b, 0) / durationsInDays.length;
  return Math.round(avg * 10) / 10;
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
    const reason = getLossReasonName(lead) || '(без причины)';
    lossReasonCounts.set(reason, (lossReasonCounts.get(reason) || 0) + 1);
  });
  const lossReasons = Array.from(lossReasonCounts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const statusNameById = new Map(statuses.map((s) => [s.id, s.name]));
  const toDealRow = (l) => ({
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
  });

  const dealsInProgress = filtered
    .filter((l) => l.status_id !== WON_STATUS_ID && l.status_id !== LOST_STATUS_ID)
    .sort((a, b) => b.created_at - a.created_at)
    .map(toDealRow);

  // Same cohort as the "Продажи" tile/rate (reached saleStageId), not just
  // amoCRM's own WON status — saleStageId can be an earlier custom stage.
  const dealsWon = filtered
    .filter((l) => reachedStage(l, saleStageId, stageOrder))
    .sort((a, b) => b.created_at - a.created_at)
    .map(toDealRow);

  return { overall, managerBreakdown, sourceTree, dealsInProgress, dealsWon, filterOptions, cost, lossReasons };
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
  buildStageOrder,
  buildDashboard,
  computeAvgSaleCycleDaysClosedInPeriod,
  WON_STATUS_ID,
  LOST_STATUS_ID
};
