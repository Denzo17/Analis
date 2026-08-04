(function (global) {
  var LA = global.LA = global.LA || {};

  var DAY = 24 * 60 * 60;

  // All day-boundary math goes through this — midnight in the *browser's*
  // local time zone, not UTC. Plain `timestamp % DAY` arithmetic (the old
  // approach for today/last7/30/90) silently computes UTC-day boundaries
  // instead, which drifted against "С начала месяца"/"Прошлый месяц"
  // (already local-time via the numeric Date constructor) and against the
  // custom-range inputs below by exactly the timezone offset — off by one
  // lead near midnight depending which preset you picked.
  function localDayStart(date) {
    return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000);
  }

  function presetRange(key) {
    var now = Math.floor(Date.now() / 1000);
    var todayStart = localDayStart(new Date());
    switch (key) {
      case 'today':
        return { from: todayStart, to: now };
      case 'last7':
        return { from: todayStart - 7 * DAY, to: now };
      case 'last30':
        return { from: todayStart - 30 * DAY, to: now };
      case 'last90':
        return { from: todayStart - 90 * DAY, to: now };
      case 'month':
        var d = new Date();
        var monthStart = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
        return { from: monthStart, to: now };
      case 'lastMonth':
        var today = new Date();
        var lastMonthStart = Math.floor(new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime() / 1000);
        var thisMonthStart = Math.floor(new Date(today.getFullYear(), today.getMonth(), 1).getTime() / 1000);
        return { from: lastMonthStart, to: thisMonthStart - 1 };
      default:
        return null;
    }
  }

  // <input type="date">'s value is "YYYY-MM-DD" with no time component —
  // passed straight to `new Date(string)`, JS parses date-only ISO strings
  // as UTC midnight, not local midnight, which is what silently caused the
  // "Прошлый месяц" vs. manually typing the same 01.07–31.07 range to
  // disagree by one lead. Parsing the parts ourselves keeps it local,
  // consistent with every preset above.
  function parseDateInputLocal(value) {
    if (!value) return null;
    var parts = value.split('-');
    return Math.floor(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime() / 1000);
  }

  // The inverse — same local-vs-UTC trap in reverse: `.toISOString()` would
  // render a local midnight timestamp as the *previous* day whenever the
  // browser is ahead of UTC.
  function formatDateInputLocal(timestamp) {
    var d = new Date(timestamp * 1000);
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  // options: [{id, name}]. isString keeps values as-is (UTM campaigns are
  // free-text); otherwise values round-trip through Number() (source ids,
  // manager ids).
  function multiSelect(label, options, selectedValues, isString) {
    var wrap = el('div', 'la-filter');
    var lbl = el('label');
    lbl.textContent = label;
    var select = el('select');
    select.multiple = true;
    options.forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.name;
      o.selected = selectedValues.indexOf(opt.id) !== -1;
      select.appendChild(o);
    });
    wrap.appendChild(lbl);
    wrap.appendChild(select);
    return {
      wrap: wrap,
      select: select,
      readValues: function () {
        return Array.from(select.selectedOptions).map(function (o) {
          return isString ? o.value : Number(o.value);
        });
      }
    };
  }

  // Renders the tab row (pipelines) + filter row into `container`.
  // opts: { pipelines, users, sources, utmCampaigns,
  //         current: {pipelineId, datePreset, dateFrom, dateTo, managerIds, sourceIds, utmCampaigns},
  //         onPipelineChange(pipelineId), onFiltersChange(filters), onOpenSettings() }
  function renderFilterBar(container, opts) {
    container.innerHTML = '';
    var topbar = el('div', 'la-topbar');

    var tabs = el('div', 'la-tabs');
    opts.pipelines.forEach(function (p) {
      var tab = el('button', 'la-tab' + (p.id === opts.current.pipelineId ? ' la-tab--active' : ''));
      tab.type = 'button';
      tab.textContent = p.name;
      tab.addEventListener('click', function () { opts.onPipelineChange(p.id); });
      tabs.appendChild(tab);
    });
    topbar.appendChild(tabs);

    var filtersRow = el('div', 'la-filters');

    // Date range preset
    var dateWrap = el('div', 'la-filter');
    var dateLabel = el('label');
    dateLabel.textContent = 'Период';
    var dateSelect = el('select');
    [
      ['last30', 'Последние 30 дней'],
      ['last7', 'Последние 7 дней'],
      ['today', 'Сегодня'],
      ['month', 'С начала месяца'],
      ['lastMonth', 'Прошлый месяц'],
      ['last90', 'Последние 90 дней'],
      ['custom', 'Произвольный период']
    ].forEach(function (pair) {
      var o = document.createElement('option');
      o.value = pair[0];
      o.textContent = pair[1];
      if (pair[0] === opts.current.datePreset) o.selected = true;
      dateSelect.appendChild(o);
    });
    dateWrap.appendChild(dateLabel);
    dateWrap.appendChild(dateSelect);

    var fromInput = document.createElement('input');
    fromInput.type = 'date';
    var toInput = document.createElement('input');
    toInput.type = 'date';
    if (opts.current.dateFrom) fromInput.value = formatDateInputLocal(opts.current.dateFrom);
    if (opts.current.dateTo) toInput.value = formatDateInputLocal(opts.current.dateTo);
    var customWrap = el('div', 'la-filter');
    customWrap.style.display = opts.current.datePreset === 'custom' ? 'flex' : 'none';
    var customLabel = el('label');
    customLabel.textContent = 'Даты (от / до)';
    var customRow = el('div');
    customRow.style.display = 'flex';
    customRow.style.gap = '4px';
    customRow.appendChild(fromInput);
    customRow.appendChild(toInput);
    customWrap.appendChild(customLabel);
    customWrap.appendChild(customRow);

    function emitDateChange() {
      var preset = dateSelect.value;
      customWrap.style.display = preset === 'custom' ? 'flex' : 'none';
      var range;
      if (preset === 'custom') {
        var from = parseDateInputLocal(fromInput.value);
        var toStart = parseDateInputLocal(toInput.value);
        var to = toStart != null ? toStart + DAY - 1 : null;
        range = { from: from, to: to };
      } else {
        range = presetRange(preset);
      }
      opts.onFiltersChange({ datePreset: preset, dateFrom: range.from, dateTo: range.to });
    }
    dateSelect.addEventListener('change', emitDateChange);
    fromInput.addEventListener('change', emitDateChange);
    toInput.addEventListener('change', emitDateChange);

    filtersRow.appendChild(dateWrap);
    filtersRow.appendChild(customWrap);

    var managers = multiSelect('Ответственные', opts.users, opts.current.managerIds || []);
    managers.select.addEventListener('change', function () {
      opts.onFiltersChange({ managerIds: managers.readValues() });
    });
    filtersRow.appendChild(managers.wrap);

    var sources = multiSelect('Источник', opts.sources, opts.current.sourceIds || []);
    sources.select.addEventListener('change', function () {
      opts.onFiltersChange({ sourceIds: sources.readValues() });
    });
    if (opts.sources.length) {
      filtersRow.appendChild(sources.wrap);
    }

    var utmOptions = (opts.utmCampaigns || []).map(function (value) { return { id: value, name: value }; });
    var utm = multiSelect('utm_campaign', utmOptions, opts.current.utmCampaigns || [], true);
    utm.select.addEventListener('change', function () {
      opts.onFiltersChange({ utmCampaigns: utm.readValues() });
    });
    if (utmOptions.length) {
      filtersRow.appendChild(utm.wrap);
    }

    var settingsBtn = el('button', 'la-settings-toggle');
    settingsBtn.type = 'button';
    settingsBtn.textContent = 'Настройки виджета';
    settingsBtn.addEventListener('click', opts.onOpenSettings);
    filtersRow.appendChild(settingsBtn);

    topbar.appendChild(filtersRow);
    container.appendChild(topbar);
  }

  LA.filters = { renderFilterBar: renderFilterBar, presetRange: presetRange };
})(window);
