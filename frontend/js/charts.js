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

  // Renders one <td> for a stat column (used by both renderTable and
  // renderTree so the meter-bar/percent/number formatting stays identical).
  function renderStatCell(col, raw) {
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
    return td;
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
        tr.appendChild(renderStatCell(col, row[col.key]));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
    container.appendChild(card);
  }

  // Expandable drill-down table (e.g. Источник клиента → utm_source →
  // utm_campaign). Each tree node is { label, <stat fields>, children }.
  // statColumns are the same shape as renderTable's columns, applied to
  // every level; the first column is always the (indented, expandable)
  // label. Top level starts expanded, everything below starts collapsed —
  // matches "показывать общее, раскрывать для глубокого анализа".
  function renderTree(container, title, labelHeader, statColumns, tree) {
    container.innerHTML = '';
    var card = el('div', 'la-card');
    if (title) card.appendChild(el('div', 'la-card__title', title));

    var wrap = el('div', 'la-table-wrap');
    var table = el('table', 'la-table la-tree-table');
    var thead = el('thead');
    var headRow = el('tr');
    headRow.appendChild(el('th', '', labelHeader));
    statColumns.forEach(function (col) {
      headRow.appendChild(el('th', col.numeric ? 'la-num' : '', col.label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el('tbody');
    var expanded = {};

    function renderRows() {
      tbody.innerHTML = '';
      if (!tree || !tree.length) {
        var emptyRow = el('tr');
        var emptyCell = el('td', '', 'Нет данных за выбранный период');
        emptyCell.colSpan = statColumns.length + 1;
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        return;
      }
      walk(tree, 0, '');
    }

    function walk(nodes, depth, parentPath) {
      nodes.forEach(function (node) {
        var path = parentPath + '›' + node.label;
        var hasChildren = node.children && node.children.length > 0;
        var tr = el('tr', 'la-tree-row');

        var labelTd = el('td');
        labelTd.style.paddingLeft = (10 + depth * 20) + 'px';
        if (hasChildren) {
          var toggle = el('button', 'la-tree-toggle', expanded[path] ? '▾' : '▸');
          toggle.type = 'button';
          toggle.addEventListener('click', function () {
            expanded[path] = !expanded[path];
            renderRows();
          });
          labelTd.appendChild(toggle);
        } else {
          labelTd.appendChild(el('span', 'la-tree-spacer'));
        }
        labelTd.appendChild(document.createTextNode(node.label));
        tr.appendChild(labelTd);

        statColumns.forEach(function (col) {
          tr.appendChild(renderStatCell(col, node[col.key]));
        });
        tbody.appendChild(tr);

        if (hasChildren && expanded[path]) {
          walk(node.children, depth + 1, path);
        }
      });
    }

    renderRows();
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

  LA.charts = {
    renderTiles: renderTiles,
    renderFunnel: renderFunnel,
    renderTable: renderTable,
    renderTree: renderTree,
    formatNumber: formatNumber,
    formatPercent: formatPercent
  };
})(window);
