(function () {
  var session = window.__LEADS_ANALYSIS_SESSION__;
  var appEl = document.getElementById('app');

  var state = {
    pipelines: [],
    users: [],
    sources: [],
    utmCampaigns: [],
    pipelineId: null,
    filters: { datePreset: 'last30', managerIds: [], sourceIds: [], utmCampaigns: [] }
  };

  var initialRange = window.LA.filters.presetRange('last30');
  state.filters.dateFrom = initialRange.from;
  state.filters.dateTo = initialRange.to;

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + session.token }, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(path, Object.assign({}, opts, { headers: headers })).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          var err = new Error(body.error || ('http_' + res.status));
          err.status = res.status;
          err.body = body;
          throw err;
        });
      }
      return res.json();
    });
  }

  function buildLayout() {
    appEl.innerHTML = '';
    var topbar = document.createElement('div');
    topbar.id = 'la-topbar-container';
    var content = document.createElement('div');
    content.id = 'la-content-container';
    content.className = 'la-content';
    appEl.appendChild(topbar);
    appEl.appendChild(content);
  }

  function setAccentColor(color) {
    if (color) {
      appEl.style.setProperty('--accent', color);
    }
  }

  function renderTopbar() {
    var container = document.getElementById('la-topbar-container');
    window.LA.filters.renderFilterBar(container, {
      pipelines: state.pipelines,
      users: state.users,
      sources: state.sources,
      utmCampaigns: state.utmCampaigns,
      current: Object.assign({ pipelineId: state.pipelineId }, state.filters),
      onPipelineChange: function (pipelineId) {
        state.pipelineId = pipelineId;
        renderTopbar();
        loadDashboard();
      },
      onFiltersChange: function (partial) {
        Object.assign(state.filters, partial);
        loadDashboard();
      },
      onOpenSettings: openSettings
    });
  }

  function currentPipeline() {
    return state.pipelines.find(function (p) { return p.id === state.pipelineId; });
  }

  function renderEmptyState(message, actionLabel, onAction) {
    var content = document.getElementById('la-content-container');
    content.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'la-empty';
    var p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);
    if (actionLabel) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', onAction);
      box.appendChild(btn);
    }
    content.appendChild(box);
  }

  function buildTileData(overall, design) {
    var byKey = {
      new_leads: overall.newCount,
      key_stage: overall.keyCount,
      key_stage_rate: overall.newToKeyRate,
      sale: overall.saleCount,
      sale_rate_from_key: overall.keyToSaleRate,
      sale_rate_from_new: overall.newToSaleRate,
      in_progress: overall.inProgressCount,
      lost: overall.lostCount
    };
    var visible = (design && design.visibleTiles) || window.LA.tileDefs.map(function (d) { return d.key; });
    return window.LA.tileDefs
      .filter(function (def) { return visible.indexOf(def.key) !== -1; })
      .map(function (def) {
        return { label: def.label, value: byKey[def.key], isPercent: !!def.isPercent, accent: def.key === 'new_leads' };
      });
  }

  function renderDashboard(data) {
    if (data.filterOptions) {
      state.sources = data.filterOptions.sources || [];
      state.utmCampaigns = data.filterOptions.utmCampaigns || [];
      renderTopbar();
    }

    var content = document.getElementById('la-content-container');
    content.innerHTML = '';
    var design = data.settings.design || {};
    setAccentColor(design.accentColor);

    var tilesHost = document.createElement('div');
    content.appendChild(tilesHost);
    window.LA.charts.renderTiles(tilesHost, buildTileData(data.overall, design));

    if (design.showFunnelChart !== false) {
      var funnelHost = document.createElement('div');
      content.appendChild(funnelHost);
      var pipeline = currentPipeline();
      var keyStatus = pipeline.statuses.find(function (s) { return s.id === data.settings.keyStageId; });
      var saleStatus = pipeline.statuses.find(function (s) { return s.id === data.settings.saleStageId; });
      window.LA.charts.renderFunnel(funnelHost, 'Воронка конверсии', [
        { label: 'Новые лиды', value: data.overall.newCount, color: 'var(--series-1)' },
        { label: (keyStatus && keyStatus.name) || 'Ключевой этап', value: data.overall.keyCount, color: 'var(--series-2)' },
        { label: (saleStatus && saleStatus.name) || 'Продажа', value: data.overall.saleCount, color: 'var(--series-3)' },
        { label: 'Отказ', value: data.overall.lostCount, color: 'var(--status-critical)' }
      ]);
    }

    if (design.showManagerTable !== false) {
      var tableHost = document.createElement('div');
      content.appendChild(tableHost);
      window.LA.charts.renderTable(tableHost, 'По менеджерам', [
        { key: 'userName', label: 'Ответственный' },
        { key: 'newCount', label: 'Новые', numeric: true },
        { key: 'newToKeyRate', label: 'Лид → Ключ, %', numeric: true, percent: true, meter: true },
        { key: 'keyCount', label: 'Ключевой этап', numeric: true },
        { key: 'keyToSaleRate', label: 'Ключ → Продажа, %', numeric: true, percent: true, meter: true },
        { key: 'saleCount', label: 'Продажи', numeric: true },
        { key: 'newToSaleRate', label: 'Лид → Продажа, %', numeric: true, percent: true, meter: true }
      ], data.managerBreakdown);
    }

    if (design.showUtmTable !== false) {
      var utmHost = document.createElement('div');
      content.appendChild(utmHost);
      window.LA.charts.renderTable(utmHost, 'По utm_campaign', [
        { key: 'utmCampaign', label: 'utm_campaign' },
        { key: 'newCount', label: 'Новые', numeric: true },
        { key: 'newToKeyRate', label: 'Лид → Ключ, %', numeric: true, percent: true, meter: true },
        { key: 'keyCount', label: 'Ключевой этап', numeric: true },
        { key: 'keyToSaleRate', label: 'Ключ → Продажа, %', numeric: true, percent: true, meter: true },
        { key: 'saleCount', label: 'Продажи', numeric: true },
        { key: 'newToSaleRate', label: 'Лид → Продажа, %', numeric: true, percent: true, meter: true }
      ], data.utmBreakdown);
    }

    if (design.showDealsInProgress !== false) {
      var dealsHost = document.createElement('div');
      content.appendChild(dealsHost);
      window.LA.charts.renderTable(dealsHost, 'Сделки в работе (' + data.overall.inProgressCount + ')', [
        { key: 'name', label: 'Сделка' },
        { key: 'responsibleUserName', label: 'Ответственный' },
        { key: 'statusName', label: 'Статус' },
        { key: 'sourceName', label: 'Источник' },
        { key: 'utmCampaign', label: 'utm_campaign' },
        { key: 'price', label: 'Бюджет', numeric: true }
      ], data.dealsInProgress.slice(0, 50));
    }
  }

  function loadDashboard() {
    var content = document.getElementById('la-content-container');
    content.innerHTML = '<div class="la-loading">Загрузка…</div>';
    var query = new URLSearchParams({
      pipelineId: state.pipelineId,
      dateFrom: state.filters.dateFrom,
      dateTo: state.filters.dateTo
    });
    if (state.filters.managerIds && state.filters.managerIds.length) query.set('managerIds', state.filters.managerIds.join(','));
    if (state.filters.sourceIds && state.filters.sourceIds.length) query.set('sourceIds', state.filters.sourceIds.join(','));
    if (state.filters.utmCampaigns && state.filters.utmCampaigns.length) query.set('utmCampaigns', state.filters.utmCampaigns.join(','));

    api('/api/dashboard/summary?' + query.toString())
      .then(renderDashboard)
      .catch(function (err) {
        if (err.status === 409 && err.body && err.body.error === 'stages_not_configured') {
          renderEmptyState(
            'Для этой воронки не выбраны ключевой этап и этап продажи. Настройте их, чтобы увидеть дашборд.',
            'Открыть настройки',
            openSettings
          );
          return;
        }
        renderEmptyState('Не удалось загрузить данные: ' + err.message, 'Повторить', loadDashboard);
      });
  }

  function openSettings() {
    var pipeline = currentPipeline();
    api('/api/settings?pipelineId=' + state.pipelineId).then(function (settings) {
      var host = document.createElement('div');
      appEl.appendChild(host);
      window.LA.settingsPanel.render(host, {
        settings: settings,
        pipelineStatuses: pipeline.statuses,
        onSave: function (payload) {
          api('/api/settings', { method: 'POST', body: JSON.stringify(Object.assign({ pipelineId: state.pipelineId }, payload)) })
            .then(function () {
              host.remove();
              loadDashboard();
            });
        },
        onClose: function () { host.remove(); }
      });
    });
  }

  function init() {
    if (!session) {
      appEl.textContent = 'Сессия не найдена.';
      return;
    }
    buildLayout();
    api('/api/filters/options')
      .then(function (data) {
        state.pipelines = data.pipelines;
        state.users = data.users;
        state.sources = data.sources;
        state.pipelineId = data.pipelines.length ? data.pipelines[0].id : null;
        if (!state.pipelineId) {
          renderEmptyState('В аккаунте не найдено ни одной воронки сделок.');
          return;
        }
        renderTopbar();
        loadDashboard();
      })
      .catch(function (err) {
        renderEmptyState('Не удалось загрузить данные аккаунта: ' + err.message);
      });
  }

  init();
})();
