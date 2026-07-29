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

async function fetchLeadsInRange(accountId, { pipelineId, dateFrom, dateTo }) {
  const leads = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = {
      limit: PAGE_LIMIT,
      page,
      with: 'source',
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

function filterLeads(leads, { managerIds, sourceIds }) {
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
    return true;
  });
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

function buildDashboard({ leads, statuses, users, keyStageId, saleStageId, filters }) {
  const stageOrder = buildStageOrder(statuses);
  const filtered = filterLeads(leads, filters || {});

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
      createdAt: l.created_at,
      price: l.price || 0
    }));

  return { overall, managerBreakdown, dealsInProgress };
}

module.exports = {
  fetchPipelines,
  fetchUsers,
  fetchSources,
  fetchLeadsInRange,
  buildDashboard,
  WON_STATUS_ID,
  LOST_STATUS_ID
};
