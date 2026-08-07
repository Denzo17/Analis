(function (global) {
  var LA = global.LA = global.LA || {};

  var DAY = 24 * 60 * 60;

  // All day-boundary math goes through this — midnight in the *browser's*
  // local time zone, not UTC. Plain `timestamp % DAY` arithmetic silently
  // computes UTC-day boundaries instead, which drifts against the numeric
  // Date constructor used elsewhere by exactly the timezone offset.
  function localDayStart(date) {
    return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000);
  }

  // Monday-start week (RU convention). getDay(): 0=Sun..6=Sat.
  function mondayOf(date) {
    var day = date.getDay();
    var diff = day === 0 ? 6 : day - 1;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff);
  }

  function presetRange(key) {
    var now = Math.floor(Date.now() / 1000);
    var today = new Date();
    var todayStart = localDayStart(today);
    switch (key) {
      case 'today':
        return { from: todayStart, to: now };
      case 'yesterday':
        return { from: todayStart - DAY, to: todayStart - 1 };
      case 'month':
        return { from: Math.floor(new Date(today.getFullYear(), today.getMonth(), 1).getTime() / 1000), to: now };
      case 'lastMonth': {
        var lastMonthStart = Math.floor(new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime() / 1000);
        var thisMonthStart = Math.floor(new Date(today.getFullYear(), today.getMonth(), 1).getTime() / 1000);
        return { from: lastMonthStart, to: thisMonthStart - 1 };
      }
      case 'currentWeek':
        return { from: localDayStart(mondayOf(today)), to: now };
      case 'lastWeek': {
        var thisMonday = mondayOf(today);
        var prevMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
        return { from: localDayStart(prevMonday), to: localDayStart(thisMonday) - 1 };
      }
      case 'currentYear':
        return { from: Math.floor(new Date(today.getFullYear(), 0, 1).getTime() / 1000), to: now };
      case 'lastYear': {
        var thisYearStart = Math.floor(new Date(today.getFullYear(), 0, 1).getTime() / 1000);
        var lastYearStart = Math.floor(new Date(today.getFullYear() - 1, 0, 1).getTime() / 1000);
        return { from: lastYearStart, to: thisYearStart - 1 };
      }
      default:
        return null;
    }
  }

  // <input type="date">'s value is "YYYY-MM-DD" with no time component —
  // passed straight to `new Date(string)`, JS parses date-only ISO strings
  // as UTC midnight, not local midnight. Parsing the parts ourselves keeps
  // it local, consistent with every preset above.
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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // A collapsed dropdown + checklist panel, standing in for a native
  // <select multiple> (which renders as an always-open scroll box) so every
  // multi-value filter looks and behaves like the Период select: collapsed
  // by default, opens on click, closes on an outside click.
  // options: [{id, name}]. onChange(values) fires on every checkbox toggle.
  function dropdownChecklist(label, options, selectedValues, onChange) {
    var wrap = el('div', 'la-filter la-dropdown-filter');
    wrap.appendChild(el('label', '', label));

    var trigger = el('button', 'la-dropdown-filter__trigger');
    trigger.type = 'button';
    wrap.appendChild(trigger);

    var panel = el('div', 'la-dropdown-filter__panel');
    panel.hidden = true;
    wrap.appendChild(panel);

    var selected = selectedValues.slice();

    function updateTrigger() {
      if (!selected.length) {
        trigger.textContent = 'Все';
      } else if (selected.length === 1) {
        var opt = options.find(function (o) { return o.id === selected[0]; });
        trigger.textContent = opt ? opt.name : String(selected[0]);
      } else {
        trigger.textContent = selected.length + ' выбрано';
      }
    }

    function onDocClick(e) {
      if (!wrap.contains(e.target)) closePanel();
    }
    function closePanel() {
      panel.hidden = true;
      document.removeEventListener('click', onDocClick);
    }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.hidden) {
        panel.hidden = false;
        setTimeout(function () { document.addEventListener('click', onDocClick); }, 0);
      } else {
        closePanel();
      }
    });

    options.forEach(function (opt) {
      var row = el('label', 'la-dropdown-filter__option');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.indexOf(opt.id) !== -1;
      cb.addEventListener('change', function () {
        var idx = selected.indexOf(opt.id);
        if (cb.checked && idx === -1) selected.push(opt.id);
        if (!cb.checked && idx !== -1) selected.splice(idx, 1);
        updateTrigger();
        onChange(selected.slice());
      });
      row.appendChild(cb);
      row.appendChild(document.createTextNode(opt.name));
      panel.appendChild(row);
    });

    updateTrigger();
    return wrap;
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
    dateWrap.appendChild(el('label', '', 'Период'));
    var dateSelect = el('select');
    [
      ['month', 'Текущий месяц'],
      ['lastMonth', 'Предыдущий месяц'],
      ['currentWeek', 'Текущая неделя'],
      ['lastWeek', 'Предыдущая неделя'],
      ['currentYear', 'Текущий год'],
      ['lastYear', 'Предыдущий год'],
      ['today', 'Сегодня'],
      ['yesterday', 'Вчера'],
      ['custom', 'Произвольный период']
    ].forEach(function (pair) {
      var o = document.createElement('option');
      o.value = pair[0];
      o.textContent = pair[1];
      if (pair[0] === opts.current.datePreset) o.selected = true;
      dateSelect.appendChild(o);
    });
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

    var managersWrap = dropdownChecklist('Ответственные', opts.users, opts.current.managerIds || [], function (values) {
      opts.onFiltersChange({ managerIds: values });
    });
    filtersRow.appendChild(managersWrap);

    var sourcesWrap = dropdownChecklist('Источник', opts.sources, opts.current.sourceIds || [], function (values) {
      opts.onFiltersChange({ sourceIds: values });
    });
    if (opts.sources.length) {
      filtersRow.appendChild(sourcesWrap);
    }

    var utmOptions = (opts.utmCampaigns || []).map(function (value) { return { id: value, name: value }; });
    var utmWrap = dropdownChecklist('utm_campaign', utmOptions, opts.current.utmCampaigns || [], function (values) {
      opts.onFiltersChange({ utmCampaigns: values });
    });
    if (utmOptions.length) {
      filtersRow.appendChild(utmWrap);
    }

    var exportWrap = el('div', 'la-dropdown-filter la-export-menu');
    var exportTrigger = el('button', 'la-settings-toggle', 'Выгрузить отчёт');
    exportTrigger.type = 'button';
    exportWrap.appendChild(exportTrigger);

    var exportPanel = el('div', 'la-dropdown-filter__panel la-export-menu__panel');
    exportPanel.hidden = true;
    exportWrap.appendChild(exportPanel);

    function closeExportPanel() {
      exportPanel.hidden = true;
      document.removeEventListener('click', onExportDocClick);
    }
    function onExportDocClick(e) {
      if (!exportWrap.contains(e.target)) closeExportPanel();
    }
    exportTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (exportPanel.hidden) {
        exportPanel.hidden = false;
        setTimeout(function () { document.addEventListener('click', onExportDocClick); }, 0);
      } else {
        closeExportPanel();
      }
    });

    [['pdf', 'PDF'], ['xlsx', 'Excel']].forEach(function (pair) {
      var optionBtn = el('button', 'la-dropdown-filter__option', pair[1]);
      optionBtn.type = 'button';
      optionBtn.addEventListener('click', function () {
        closeExportPanel();
        opts.onExport(pair[0]);
      });
      exportPanel.appendChild(optionBtn);
    });
    filtersRow.appendChild(exportWrap);

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
