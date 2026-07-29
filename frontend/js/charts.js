(function (global) {
  var LA = global.LA = global.LA || {};

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(value || 0));
  }

  function formatPercent(value) {
    return (Math.round((value || 0) * 100) / 100).toLocaleString('ru-RU') + '%';
  }

  // tiles: [{ label, value, isPercent, accent }]
  function renderTiles(container, tiles) {
    container.innerHTML = '';
    var wrap = el('div', 'la-tiles');
    tiles.forEach(function (tile) {
      var box = el('div', 'la-tile');
      box.appendChild(el('div', 'la-tile__label', tile.label));
      var valueEl = el('div', 'la-tile__value' + (tile.accent ? ' la-tile__value--accent' : ''));
      valueEl.textContent = tile.isPercent ? formatPercent(tile.value) : formatNumber(tile.value);
      box.appendChild(valueEl);
      wrap.appendChild(box);
    });
    container.appendChild(wrap);
  }

  // steps: [{ label, value, color }]. Bars are scaled against the first
  // (largest / "new leads") step, matching the read-top-to-bottom funnel
  // convention from the reference dashboard.
  function renderFunnel(container, title, steps) {
    container.innerHTML = '';
    var card = el('div', 'la-card');
    card.appendChild(el('div', 'la-card__title', title));
    var bars = el('div', 'la-bars');
    var max = Math.max.apply(null, steps.map(function (s) { return s.value; }).concat([1]));

    steps.forEach(function (step) {
      var row = el('div', 'la-bar-row');
      row.appendChild(el('div', 'la-bar-row__label', step.label));
      var track = el('div', 'la-bar-track');
      var fill = el('div', 'la-bar-fill');
      var pct = max > 0 ? (step.value / max) * 100 : 0;
      fill.style.width = Math.max(pct, step.value > 0 ? 1 : 0) + '%';
      fill.style.background = step.color;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'la-bar-row__value', formatNumber(step.value)));
      bars.appendChild(row);
    });

    card.appendChild(bars);
    container.appendChild(card);
  }

  // columns: [{ key, label, numeric, percent, meter }]
  // rows: array of plain objects keyed by column.key
  function renderTable(container, title, columns, rows) {
    container.innerHTML = '';
    var card = el('div', 'la-card');
    if (title) card.appendChild(el('div', 'la-card__title', title));

    var wrap = el('div', 'la-table-wrap');
    var table = el('table', 'la-table');
    var thead = el('thead');
    var headRow = el('tr');
    columns.forEach(function (col) {
      headRow.appendChild(el('th', col.numeric ? 'la-num' : '', col.label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el('tbody');
    if (!rows.length) {
      var emptyRow = el('tr');
      var emptyCell = el('td', '', 'Нет данных за выбранный период');
      emptyCell.colSpan = columns.length;
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    }
    rows.forEach(function (row) {
      var tr = el('tr');
      columns.forEach(function (col) {
        var raw = row[col.key];
        var td = el('td', col.numeric ? 'la-num' : '');
        var text = col.percent ? formatPercent(raw) : (col.numeric ? formatNumber(raw) : (raw == null ? '' : String(raw)));
        if (col.meter) {
          td.classList.add('la-meter-cell');
          var bar = el('div', 'la-meter-cell__bar');
          bar.style.width = Math.min(Math.max(raw || 0, 0), 100) + '%';
          var valueSpan = el('span', 'la-meter-cell__value', text);
          td.appendChild(bar);
          td.appendChild(valueSpan);
        } else {
          td.textContent = text;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
    container.appendChild(card);
  }

  LA.tileDefs = [
    { key: 'new_leads', label: 'Новые лиды' },
    { key: 'key_stage', label: 'Ключевой этап' },
    { key: 'key_stage_rate', label: 'Лид → Ключевой, %', isPercent: true },
    { key: 'sale', label: 'Продажи' },
    { key: 'sale_rate_from_key', label: 'Ключевой → Продажа, %', isPercent: true },
    { key: 'sale_rate_from_new', label: 'Лид → Продажа, %', isPercent: true },
    { key: 'in_progress', label: 'В работе' },
    { key: 'lost', label: 'Отказ' }
  ];

  LA.charts = { renderTiles: renderTiles, renderFunnel: renderFunnel, renderTable: renderTable, formatNumber: formatNumber, formatPercent: formatPercent };
})(window);
