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

  function formatCurrency(value) {
    if (value == null) return '—';
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
  }

  function formatDays(value) {
    if (value == null) return '—';
    return (Math.round(value * 10) / 10).toLocaleString('ru-RU') + ' дн.';
  }

  // tiles: [{ label, value, isPercent, isCurrency, isDays, accent }]
  // title (optional): wraps the tiles in a titled card, e.g. for a smaller
  // KPI block lower on the page instead of the untitled top row.
  function renderTiles(container, tiles, title) {
    container.innerHTML = '';
    var host = container;
    if (title) {
      var card = el('div', 'la-card');
      card.appendChild(el('div', 'la-card__title', title));
      host = card;
    }
    var wrap = el('div', 'la-tiles' + (title ? ' la-tiles--nested' : ''));
    tiles.forEach(function (tile) {
      var box = el('div', 'la-tile');
      box.appendChild(el('div', 'la-tile__label', tile.label));
      var valueEl = el('div', 'la-tile__value' + (tile.accent ? ' la-tile__value--accent' : ''));
      valueEl.textContent = tile.isCurrency ? formatCurrency(tile.value)
        : tile.isDays ? formatDays(tile.value)
        : tile.isPercent ? formatPercent(tile.value)
        : formatNumber(tile.value);
      box.appendChild(valueEl);
      wrap.appendChild(box);
    });
    host.appendChild(wrap);
    if (title) container.appendChild(host);
  }

  // steps: [{ label, value, color, children?, sharePercent? }]. Bars are
  // scaled against the first (largest / "new leads") step, matching the
  // read-top-to-bottom funnel convention from the reference dashboard. A
  // step with `children` ([{label, value}], e.g. loss reasons under
  // "Отказ") gets an expand arrow; its children render as smaller indented
  // bars scaled against their own max (their counts are usually much
  // smaller than the funnel steps, so scaling them against the same max as
  // the parent would make them unreadably thin) and show what share of the
  // parent's own value they are. `sharePercent` on a top-level step (e.g.
  // Отказ's share of Новые лиды) shows the same way, next to its count.
  function renderFunnel(container, title, steps) {
    container.innerHTML = '';
    var card = el('div', 'la-card');
    card.appendChild(el('div', 'la-card__title', title));
    var bars = el('div', 'la-bars');
    var max = Math.max.apply(null, steps.map(function (s) { return s.value; }).concat([1]));
    var expanded = {};

    function appendBarRow(host, label, value, localMax, color, extraClass, shareOfParent) {
      var row = el('div', 'la-bar-row' + (extraClass ? ' ' + extraClass : ''));
      row.appendChild(el('div', 'la-bar-row__label', label));
      var track = el('div', 'la-bar-track');
      var fill = el('div', 'la-bar-fill');
      var pct = localMax > 0 ? (value / localMax) * 100 : 0;
      fill.style.width = Math.max(pct, value > 0 ? 1 : 0) + '%';
      fill.style.background = color;
      track.appendChild(fill);
      row.appendChild(track);
      var valueText = formatNumber(value);
      if (shareOfParent != null) {
        valueText += ' (' + formatPercent(shareOfParent) + ')';
      }
      row.appendChild(el('div', 'la-bar-row__value', valueText));
      host.appendChild(row);
      return row;
    }

    function renderBars() {
      bars.innerHTML = '';
      steps.forEach(function (step, idx) {
        var hasChildren = step.children && step.children.length > 0;
        var row = appendBarRow(bars, null, step.value, max, step.color, null, step.sharePercent);
        var labelCell = row.querySelector('.la-bar-row__label');
        if (hasChildren) {
          var toggle = el('button', 'la-tree-toggle', expanded[idx] ? '▾' : '▸');
          toggle.type = 'button';
          toggle.addEventListener('click', function () {
            expanded[idx] = !expanded[idx];
            renderBars();
          });
          labelCell.appendChild(toggle);
        }
        labelCell.appendChild(document.createTextNode(step.label));

        if (hasChildren && expanded[idx]) {
          var childMax = Math.max.apply(null, step.children.map(function (c) { return c.value; }).concat([1]));
          step.children.forEach(function (child) {
            var shareOfParent = step.value > 0 ? (child.value / step.value) * 100 : 0;
            appendBarRow(bars, child.label, child.value, childMax, step.color, 'la-bar-row--child', shareOfParent);
          });
        }
      });
    }

    renderBars();
    card.appendChild(bars);
    container.appendChild(card);
  }

  // Renders one <td> for a stat column (used by both renderTable and
  // renderTree so the meter-bar/percent/number formatting stays identical).
  function renderStatCell(col, raw) {
    var td = el('td', col.numeric || col.currency || col.days ? 'la-num' : '');
    var text = col.currency
      ? formatCurrency(raw)
      : (col.days ? formatDays(raw) : (col.percent ? formatPercent(raw) : (col.numeric ? formatNumber(raw) : (raw == null ? '' : String(raw)))));
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

  // columns: [{ key, label, numeric, percent, meter, sumInFooter }]
  // rows: array of plain objects keyed by column.key
  // opts:
  //   totalsSource — full (unsliced) row set to total columns marked
  //     `sumInFooter` over, when `rows` itself is a truncated slice for
  //     display (defaults to `rows`).
  //   collapsible — render the title as a toggle and start the table
  //     collapsed, for tables that don't need to stay open by default.
  function renderTable(container, title, columns, rows, opts) {
    opts = opts || {};
    container.innerHTML = '';
    var card = el('div', 'la-card');

    var wrap = el('div', 'la-table-wrap');
    var collapsed = !!opts.collapsible;
    if (title) {
      if (opts.collapsible) {
        var titleRow = el('div', 'la-card__title la-card__title--toggle');
        var arrow = el('span', 'la-tree-toggle', collapsed ? '▸' : '▾');
        titleRow.appendChild(arrow);
        titleRow.appendChild(document.createTextNode(title));
        titleRow.addEventListener('click', function () {
          collapsed = !collapsed;
          arrow.textContent = collapsed ? '▸' : '▾';
          wrap.style.display = collapsed ? 'none' : '';
        });
        card.appendChild(titleRow);
      } else {
        card.appendChild(el('div', 'la-card__title', title));
      }
    }
    if (collapsed) wrap.style.display = 'none';

    var table = el('table', 'la-table');
    var thead = el('thead');
    var headRow = el('tr');
    columns.forEach(function (col) {
      headRow.appendChild(el('th', col.numeric || col.currency ? 'la-num' : '', col.label));
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

    if (rows.length && columns.some(function (c) { return c.sumInFooter; })) {
      var totalsSource = opts.totalsSource || rows;
      var totalTr = el('tr', 'la-table-total-row');
      columns.forEach(function (col, idx) {
        if (idx === 0) {
          totalTr.appendChild(el('td', '', 'Итого'));
          return;
        }
        if (col.sumInFooter) {
          var sum = totalsSource.reduce(function (acc, r) { return acc + (Number(r[col.key]) || 0); }, 0);
          totalTr.appendChild(renderStatCell(col, sum));
        } else {
          totalTr.appendChild(el('td', col.numeric || col.currency || col.days ? 'la-num' : ''));
        }
      });
      tbody.appendChild(totalTr);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
    container.appendChild(card);
  }

  // Expandable drill-down table (e.g. Источник клиента → utm_source →
  // utm_campaign). Each tree node is { label, path, <stat fields>, spend,
  // cpl, cac, children }. statColumns are the same shape as renderTable's
  // columns, applied to every level; the first column is always the
  // (indented, expandable) label. Top level starts expanded, everything
  // below starts collapsed — matches "показывать общее, раскрывать для
  // глубокого анализа".
  //
  // A column with `editable: true` (the "Затраты" column) renders a number
  // input instead of static text, prefilled from node.spend/node.path. On
  // input it recomputes that row's cpl/cac cells immediately client-side
  // (no round trip — we already have the row's own newCount/saleCount), and
  // on change it persists via opts.onSpendChange(path, amount) — fire and
  // forget, no dashboard reload needed since the UI already reflects it.
  function renderTree(container, title, labelHeader, statColumns, tree, opts) {
    opts = opts || {};
    container.innerHTML = '';
    var card = el('div', 'la-card');
    if (title) card.appendChild(el('div', 'la-card__title', title));

    var wrap = el('div', 'la-table-wrap');
    var table = el('table', 'la-table la-tree-table');
    var thead = el('thead');
    var headRow = el('tr');
    headRow.appendChild(el('th', '', labelHeader));
    statColumns.forEach(function (col) {
      headRow.appendChild(el('th', col.numeric || col.currency || col.editable ? 'la-num' : '', col.label));
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

        var cplTd = null;
        var cacTd = null;
        statColumns.forEach(function (col) {
          if (col.editable) {
            var td = el('td', 'la-num la-editable-cell');
            var input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.step = '1';
            input.className = 'la-tree-spend-input';
            input.placeholder = '0';
            if (node.spend != null) input.value = node.spend;
            input.addEventListener('input', function () {
              var amount = Number(input.value) || 0;
              node.spend = amount;
              node.cpl = amount && node.newCount ? Math.round((amount / node.newCount) * 100) / 100 : null;
              node.cac = amount && node.saleCount ? Math.round((amount / node.saleCount) * 100) / 100 : null;
              if (cplTd) cplTd.textContent = formatCurrency(node.cpl);
              if (cacTd) cacTd.textContent = formatCurrency(node.cac);
            });
            input.addEventListener('change', function () {
              opts.onSpendChange && opts.onSpendChange(node.path, Number(input.value) || 0);
            });
            td.appendChild(input);
            tr.appendChild(td);
            return;
          }
          var cell = renderStatCell(col, node[col.key]);
          if (col.key === 'cpl') cplTd = cell;
          if (col.key === 'cac') cacTd = cell;
          tr.appendChild(cell);
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
    { key: 'sale', label: 'Продажи из лидов выбранного периода' },
    { key: 'sale_rate_from_key', label: 'Ключевой → Продажа, %', isPercent: true },
    { key: 'sale_rate_from_new', label: 'Лид → Продажа, %', isPercent: true },
    { key: 'in_progress', label: 'В работе' },
    { key: 'lost', label: 'Отказ' },
    { key: 'cost_per_lead', label: 'Цена лида (сайт)', isCurrency: true },
    { key: 'cost_per_sale', label: 'Цена клиента (сайт)', isCurrency: true }
  ];

  // Separate from tileDefs (settings-panel visibility list) — this pair
  // renders in its own titled block lower on the page, not the top KPI row,
  // and isn't individually toggleable there.
  LA.bottomTileDefs = [
    { key: 'avg_sale_cycle', label: 'Цикл сделки', isDays: true },
    { key: 'sale_fact', label: 'Факт продаж в выбранный период' }
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
