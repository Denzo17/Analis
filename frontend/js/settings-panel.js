(function (global) {
  var LA = global.LA = global.LA || {};

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function stageSelect(label, statuses, selectedId) {
    var wrap = el('div', 'la-settings__group');
    var title = el('div', 'la-settings__group-title');
    title.textContent = label;
    var select = document.createElement('select');
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Не выбрано';
    select.appendChild(placeholder);
    statuses.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      if (Number(selectedId) === s.id) o.selected = true;
      select.appendChild(o);
    });
    wrap.appendChild(title);
    wrap.appendChild(select);
    return { wrap: wrap, select: select };
  }

  // opts: { settings: {keyStageId, saleStageId, design}, pipelineStatuses, onSave(payload), onClose() }
  function render(container, opts) {
    container.innerHTML = '';
    var overlay = el('div', 'la-settings');
    var panel = el('div', 'la-settings__panel');

    var title = el('div', 'la-settings__title');
    title.textContent = 'Настройки дашборда';
    panel.appendChild(title);

    var keyStage = stageSelect('Ключевой этап воронки', opts.pipelineStatuses, opts.settings.keyStageId);
    var saleStage = stageSelect('Этап продажи', opts.pipelineStatuses, opts.settings.saleStageId);
    panel.appendChild(keyStage.wrap);
    panel.appendChild(saleStage.wrap);

    var accentGroup = el('div', 'la-settings__group');
    var accentTitle = el('div', 'la-settings__group-title', undefined);
    accentTitle.textContent = 'Акцентный цвет';
    var accentInput = document.createElement('input');
    accentInput.type = 'color';
    accentInput.value = (opts.settings.design && opts.settings.design.accentColor) || '#2e6be6';
    accentGroup.appendChild(accentTitle);
    accentGroup.appendChild(accentInput);
    panel.appendChild(accentGroup);

    var tilesGroup = el('div', 'la-settings__group');
    var tilesTitle = el('div', 'la-settings__group-title');
    tilesTitle.textContent = 'Показатели на дашборде';
    tilesGroup.appendChild(tilesTitle);
    var visibleTiles = (opts.settings.design && opts.settings.design.visibleTiles) || LA.tileDefs.map(function (t) { return t.key; });
    var tileCheckboxes = {};
    LA.tileDefs.forEach(function (def) {
      var row = el('label', 'la-settings__checkbox');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = visibleTiles.indexOf(def.key) !== -1;
      tileCheckboxes[def.key] = cb;
      row.appendChild(cb);
      row.appendChild(document.createTextNode(def.label));
      tilesGroup.appendChild(row);
    });
    panel.appendChild(tilesGroup);

    var blocksGroup = el('div', 'la-settings__group');
    var blocksTitle = el('div', 'la-settings__group-title');
    blocksTitle.textContent = 'Блоки дашборда';
    blocksGroup.appendChild(blocksTitle);
    var blockDefs = [
      ['showFunnelChart', 'Воронка конверсии'],
      ['showManagerTable', 'Таблица по менеджерам'],
      ['showSourceTree', 'Источник клиента → utm_source → utm_campaign'],
      ['showDealsInProgress', 'Сделки в работе'],
      ['showDealsWon', 'Успешные сделки'],
      ['showAvgSaleCycleDeals', 'Сделки в расчёте среднего цикла']
    ];
    var blockCheckboxes = {};
    blockDefs.forEach(function (pair) {
      var row = el('label', 'la-settings__checkbox');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      var current = opts.settings.design ? opts.settings.design[pair[0]] : true;
      cb.checked = current !== false;
      blockCheckboxes[pair[0]] = cb;
      row.appendChild(cb);
      row.appendChild(document.createTextNode(pair[1]));
      blocksGroup.appendChild(row);
    });
    panel.appendChild(blocksGroup);

    var actions = el('div', 'la-settings__actions');
    var saveBtn = el('button', 'la-btn la-btn--primary');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Сохранить';
    var cancelBtn = el('button', 'la-btn la-btn--ghost');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Отмена';
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    panel.appendChild(actions);

    saveBtn.addEventListener('click', function () {
      var visible = LA.tileDefs.filter(function (def) { return tileCheckboxes[def.key].checked; }).map(function (def) { return def.key; });
      var design = {
        accentColor: accentInput.value,
        visibleTiles: visible,
        showFunnelChart: blockCheckboxes.showFunnelChart.checked,
        showManagerTable: blockCheckboxes.showManagerTable.checked,
        showSourceTree: blockCheckboxes.showSourceTree.checked,
        showDealsInProgress: blockCheckboxes.showDealsInProgress.checked,
        showDealsWon: blockCheckboxes.showDealsWon.checked,
        showAvgSaleCycleDeals: blockCheckboxes.showAvgSaleCycleDeals.checked
      };
      opts.onSave({
        keyStageId: keyStage.select.value ? Number(keyStage.select.value) : null,
        saleStageId: saleStage.select.value ? Number(saleStage.select.value) : null,
        design: design
      });
    });
    cancelBtn.addEventListener('click', opts.onClose);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) opts.onClose();
    });

    overlay.appendChild(panel);
    container.appendChild(overlay);
  }

  LA.settingsPanel = { render: render };
})(window);
