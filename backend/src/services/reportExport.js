const path = require('path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const FONT_REGULAR = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

// Same palette as the dashboard's light theme (frontend/css/dashboard.css)
// so the PDF reads as the same product, not a generic printout.
const COLOR_ACCENT = '#2a78d6';
const COLOR_SERIES_2 = '#eb6834';
const COLOR_SERIES_3 = '#1baf7a';
const COLOR_CRITICAL = '#d03b3b';
const COLOR_TEXT = '#0b0b0b';
const COLOR_TEXT_SECONDARY = '#52514e';
const COLOR_TEXT_MUTED = '#898781';
const COLOR_GRIDLINE = '#e1e0d9';
const COLOR_CARD_BG = '#f7f7f5';
const COLOR_HEADER_BG = '#eaf1fb';
const COLOR_ZEBRA_BG = '#f7f7f5';

function formatNumber(v) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(v || 0));
}
function formatPercent(v) {
  if (v == null) return '—';
  return (Math.round(v * 100) / 100).toLocaleString('ru-RU') + '%';
}
function formatCurrency(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v);
}
function formatDays(v) {
  if (v == null) return '—';
  return (Math.round(v * 10) / 10).toLocaleString('ru-RU') + ' дн.';
}
function formatDateCell(seconds) {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleDateString('ru-RU');
}

function formatCellText(col, raw) {
  if (col.type === 'currency') return formatCurrency(raw);
  if (col.type === 'percent') return formatPercent(raw);
  if (col.type === 'days') return formatDays(raw);
  if (col.type === 'date') return formatDateCell(raw);
  if (col.type === 'number') return formatNumber(raw);
  return raw == null ? '' : String(raw);
}

function dealColumns() {
  return [
    { key: 'name', label: 'Сделка', type: 'text' },
    { key: 'responsibleUserName', label: 'Ответственный', type: 'text' },
    { key: 'statusName', label: 'Статус', type: 'text' },
    { key: 'sourceName', label: 'Источник', type: 'text' },
    { key: 'utmCampaign', label: 'utm_campaign', type: 'text' },
    { key: 'price', label: 'Бюджет', type: 'currency' }
  ];
}

// Flattens the Источник клиента drill-down tree into rows for a report —
// nesting is shown via a leading indent on the label instead of an
// expand/collapse control, since a static document has no interaction.
function flattenTree(nodes, depth, out) {
  (nodes || []).forEach((node) => {
    out.push({
      label: '  '.repeat(depth) + node.label,
      newCount: node.newCount,
      newToKeyRate: node.newToKeyRate,
      keyCount: node.keyCount,
      keyToSaleRate: node.keyToSaleRate,
      saleCount: node.saleCount,
      newToSaleRate: node.newToSaleRate,
      spend: node.spend,
      cpl: node.cpl,
      cac: node.cac
    });
    if (node.children && node.children.length) flattenTree(node.children, depth + 1, out);
  });
  return out;
}

// dashboard: same payload shape returned by GET /api/dashboard/summary.
// meta: { periodLabel, managerNames, sourceNames, utmCampaigns } for the
// report header, describing which filters were applied.
function buildReportModel(dashboard, meta) {
  const design = (dashboard.settings && dashboard.settings.design) || {};
  const overall = dashboard.overall;
  const sections = [];

  const dealsWon = dashboard.dealsWon || [];
  const dealsWonSum = dealsWon.reduce((sum, d) => sum + (Number(d.price) || 0), 0);
  const topAvgCheck = overall.saleCount ? Math.round((dealsWonSum / overall.saleCount) * 100) / 100 : null;

  const topTileByKey = {
    new_leads: overall.newCount,
    key_stage: overall.keyCount,
    key_stage_rate: overall.newToKeyRate,
    sale: overall.saleCount,
    sale_rate_from_key: overall.keyToSaleRate,
    sale_rate_from_new: overall.newToSaleRate,
    in_progress: overall.inProgressCount,
    lost: overall.lostCount,
    cost_per_lead: dashboard.cost ? dashboard.cost.cpl : null,
    cost_per_sale: dashboard.cost ? dashboard.cost.cac : null,
    avg_check: topAvgCheck
  };
  const topTileDefs = [
    { key: 'new_leads', label: 'Новые лиды', type: 'number' },
    { key: 'key_stage', label: 'Ключевой этап', type: 'number' },
    { key: 'key_stage_rate', label: 'Лид → Ключевой, %', type: 'percent' },
    { key: 'sale', label: 'Продажи из лидов выбранного периода', type: 'number' },
    { key: 'sale_rate_from_key', label: 'Ключевой → Продажа, %', type: 'percent' },
    { key: 'sale_rate_from_new', label: 'Лид → Продажа, %', type: 'percent' },
    { key: 'in_progress', label: 'В работе', type: 'number' },
    { key: 'lost', label: 'Отказ', type: 'number' },
    { key: 'cost_per_lead', label: 'Цена лида (сайт)', type: 'currency' },
    { key: 'cost_per_sale', label: 'Цена клиента (сайт)', type: 'currency' },
    { key: 'avg_check', label: 'Средний чек', type: 'currency' }
  ];
  const visibleTiles = design.visibleTiles || topTileDefs.map((d) => d.key);
  sections.push({
    id: 'top',
    title: 'Верхний дашборд',
    kind: 'kv',
    rows: topTileDefs
      .filter((d) => visibleTiles.indexOf(d.key) !== -1)
      .map((d) => ({ label: d.label, value: topTileByKey[d.key], type: d.type }))
  });

  const cycleDeals = dashboard.avgSaleCycleDeals || [];
  const saleFactCount = cycleDeals.length;
  const saleFactAmount = cycleDeals.reduce((sum, d) => sum + (Number(d.price) || 0), 0);
  const bottomAvgCheck = saleFactCount ? Math.round((saleFactAmount / saleFactCount) * 100) / 100 : null;
  const bottomTileByKey = {
    avg_sale_cycle: dashboard.avgSaleCycleDays,
    sale_fact: saleFactCount,
    sale_fact_amount: saleFactAmount,
    avg_check: bottomAvgCheck
  };
  const bottomTileDefs = [
    { key: 'avg_sale_cycle', label: 'Цикл сделки', type: 'days' },
    { key: 'sale_fact', label: 'Факт продаж в выбранный период (кол-во)', type: 'number' },
    { key: 'sale_fact_amount', label: 'Факт суммы продаж в выбранный период', type: 'currency' },
    { key: 'avg_check', label: 'Средний чек', type: 'currency' }
  ];
  const visibleBottomTiles = design.visibleBottomTiles || bottomTileDefs.map((d) => d.key);
  const bottomRows = bottomTileDefs.filter((d) => visibleBottomTiles.indexOf(d.key) !== -1);
  if (bottomRows.length) {
    sections.push({
      id: 'bottom',
      title: 'Факт продаж выбранного периода',
      kind: 'kv',
      rows: bottomRows.map((d) => ({ label: d.label, value: bottomTileByKey[d.key], type: d.type }))
    });
  }

  if (design.showFunnelChart !== false) {
    const lostShare = overall.newCount ? (overall.lostCount / overall.newCount) * 100 : 0;
    const funnelRows = [
      { stage: 'Новые лиды', value: overall.newCount, share: null, color: COLOR_ACCENT, child: false },
      { stage: 'Ключевой этап', value: overall.keyCount, share: null, color: COLOR_SERIES_2, child: false },
      { stage: 'Продажи', value: overall.saleCount, share: null, color: COLOR_SERIES_3, child: false },
      { stage: 'Отказ', value: overall.lostCount, share: lostShare, color: COLOR_CRITICAL, child: false }
    ];
    (dashboard.lossReasons || []).forEach((r) => {
      funnelRows.push({
        stage: '  ' + r.label,
        value: r.value,
        share: overall.lostCount ? (r.value / overall.lostCount) * 100 : 0,
        color: COLOR_CRITICAL,
        child: true
      });
    });
    sections.push({
      id: 'funnel',
      title: 'Воронка конверсии',
      kind: 'table',
      columns: [
        { key: 'stage', label: 'Этап', type: 'text' },
        { key: 'value', label: 'Значение', type: 'number' },
        { key: 'share', label: 'Доля, %', type: 'percent' }
      ],
      rows: funnelRows
    });
  }

  if (design.showManagerTable !== false) {
    sections.push({
      id: 'managers',
      title: 'По менеджерам',
      kind: 'table',
      columns: [
        { key: 'userName', label: 'Ответственный', type: 'text' },
        { key: 'newCount', label: 'Новые', type: 'number' },
        { key: 'newToKeyRate', label: 'Лид → Ключ, %', type: 'percent' },
        { key: 'keyCount', label: 'Ключевой этап', type: 'number' },
        { key: 'keyToSaleRate', label: 'Ключ → Продажа, %', type: 'percent' },
        { key: 'saleCount', label: 'Продажи', type: 'number' },
        { key: 'newToSaleRate', label: 'Лид → Продажа, %', type: 'percent' }
      ],
      rows: dashboard.managerBreakdown || []
    });
  }

  if (design.showSourceTree !== false) {
    sections.push({
      id: 'sourceTree',
      title: 'Источник клиента',
      kind: 'table',
      columns: [
        { key: 'label', label: 'Источник / utm_source / utm_campaign', type: 'text' },
        { key: 'newCount', label: 'Новые', type: 'number' },
        { key: 'newToKeyRate', label: 'Лид → Ключ, %', type: 'percent' },
        { key: 'keyCount', label: 'Ключевой этап', type: 'number' },
        { key: 'keyToSaleRate', label: 'Ключ → Продажа, %', type: 'percent' },
        { key: 'saleCount', label: 'Продажи', type: 'number' },
        { key: 'newToSaleRate', label: 'Лид → Продажа, %', type: 'percent' },
        { key: 'spend', label: 'Затраты', type: 'currency' },
        { key: 'cpl', label: 'Цена лида', type: 'currency' },
        { key: 'cac', label: 'Цена клиента', type: 'currency' }
      ],
      rows: flattenTree(dashboard.sourceTree, 0, [])
    });
  }

  const dealCols = dealColumns();
  if (design.showDealsInProgress !== false) {
    sections.push({ id: 'dealsInProgress', title: 'Сделки в работе', kind: 'table', columns: dealCols, rows: dashboard.dealsInProgress || [] });
  }
  if (design.showDealsLost !== false) {
    sections.push({ id: 'dealsLost', title: 'Отказы', kind: 'table', columns: dealCols, rows: dashboard.dealsLost || [] });
  }
  if (design.showDealsWon !== false) {
    sections.push({ id: 'dealsWon', title: 'Успешные сделки', kind: 'table', columns: dealCols, rows: dashboard.dealsWon || [] });
  }
  if (design.showAvgSaleCycleDeals !== false) {
    sections.push({
      id: 'cycleDeals',
      title: 'Сделки в расчёте среднего цикла сделки',
      kind: 'table',
      columns: [
        { key: 'name', label: 'Сделка', type: 'text' },
        { key: 'responsibleUserName', label: 'Ответственный', type: 'text' },
        { key: 'statusName', label: 'Статус', type: 'text' },
        { key: 'sourceName', label: 'Источник', type: 'text' },
        { key: 'utmCampaign', label: 'utm_campaign', type: 'text' },
        { key: 'createdAt', label: 'Дата создания', type: 'date' },
        { key: 'reachedAt', label: 'Дата перехода в продажу', type: 'date' },
        { key: 'cycleDays', label: 'Цикл сделки', type: 'days' },
        { key: 'price', label: 'Бюджет', type: 'currency' }
      ],
      rows: cycleDeals
    });
  }

  return {
    title: 'Анализ лидов — отчёт',
    pipelineName: dashboard.pipeline ? dashboard.pipeline.name : '',
    meta: meta || {},
    sections
  };
}

// KPI tiles as a card grid (rounded box, muted label on top, bold value
// below) — same shape as the dashboard's .la-tile boxes.
function drawTileGrid(doc, rows) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cols = 4;
  const gap = 8;
  const cardWidth = (pageWidth - gap * (cols - 1)) / cols;
  const cardHeight = 46;
  let col = 0;
  let y = doc.y;
  rows.forEach((row) => {
    if (col === 0 && y + cardHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.y;
    }
    const x = doc.page.margins.left + col * (cardWidth + gap);
    doc.roundedRect(x, y, cardWidth, cardHeight, 4).fillAndStroke(COLOR_CARD_BG, COLOR_GRIDLINE);
    doc.fillColor(COLOR_TEXT_MUTED).font('base').fontSize(7)
      .text(row.label, x + 8, y + 7, { width: cardWidth - 16, height: 16, ellipsis: true });
    doc.fillColor(COLOR_TEXT).font('base-bold').fontSize(13)
      .text(formatCellText({ type: row.type }, row.value), x + 8, y + 24, { width: cardWidth - 16, height: 18, ellipsis: true, lineBreak: false });
    col += 1;
    if (col >= cols) { col = 0; y += cardHeight + gap; }
  });
  if (col !== 0) y += cardHeight + gap;
  doc.y = y;
  doc.x = doc.page.margins.left;
  doc.fillColor(COLOR_TEXT);
}

// Colored horizontal bars, same read as the dashboard's funnel chart —
// loss-reason rows (child: true) render smaller and indented under Отказ.
function drawFunnelBars(doc, rows) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const labelWidth = 150;
  const valueWidth = 90;
  const barMaxWidth = pageWidth - labelWidth - valueWidth - 16;
  const topMax = Math.max.apply(null, rows.filter((r) => !r.child).map((r) => r.value).concat([1]));
  const childMax = Math.max.apply(null, rows.filter((r) => r.child).map((r) => r.value).concat([1]));

  rows.forEach((row) => {
    const barHeight = row.child ? 9 : 13;
    const rowHeight = barHeight + 5;
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const indent = row.child ? 14 : 0;
    const x0 = doc.page.margins.left;
    const y0 = doc.y;
    doc.font('base').fontSize(row.child ? 7 : 9).fillColor(COLOR_TEXT)
      .text(row.stage, x0 + indent, y0 + 2, { width: labelWidth - indent, height: barHeight, lineBreak: false, ellipsis: true });
    const barX = x0 + labelWidth;
    const localMax = row.child ? childMax : topMax;
    const w = localMax > 0 ? Math.max((row.value / localMax) * barMaxWidth, row.value > 0 ? 3 : 0) : 0;
    doc.rect(barX, y0, w, barHeight).fill(row.color || COLOR_ACCENT);
    let valueText = formatNumber(row.value);
    if (row.share != null) valueText += ' (' + formatPercent(row.share) + ')';
    doc.font('base').fontSize(8).fillColor(COLOR_TEXT)
      .text(valueText, barX + barMaxWidth + 8, y0 + 2, { width: valueWidth, height: barHeight, lineBreak: false });
    doc.y = y0 + rowHeight;
  });
  doc.x = doc.page.margins.left;
  doc.fillColor(COLOR_TEXT);
}

// A plain data table, but with a tinted header row and zebra striping —
// same reading aid as .la-table on the dashboard.
function drawStyledTable(doc, columns, rows) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = pageWidth / columns.length;
  const rowHeight = 16;
  const x0 = doc.page.margins.left;

  function drawRow(cells, opts) {
    opts = opts || {};
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const y = doc.y;
    if (opts.headerBg) {
      doc.rect(x0, y, pageWidth, rowHeight).fill(COLOR_HEADER_BG);
    } else if (opts.zebra) {
      doc.rect(x0, y, pageWidth, rowHeight).fill(COLOR_ZEBRA_BG);
    }
    let x = x0;
    doc.font(opts.bold ? 'base-bold' : 'base').fontSize(8).fillColor(opts.headerBg ? COLOR_ACCENT : COLOR_TEXT);
    columns.forEach((col, i) => {
      doc.text(String(cells[i]), x + 4, y + 4, { width: colWidth - 8, height: rowHeight - 4, ellipsis: true, lineBreak: false });
      x += colWidth;
    });
    doc.y = y + rowHeight;
  }

  drawRow(columns.map((c) => c.label), { bold: true, headerBg: true });
  if (!rows.length) {
    drawRow(['Нет данных за выбранный период'].concat(columns.slice(1).map(() => '')), {});
  } else {
    rows.forEach((row, idx) => {
      drawRow(columns.map((c) => formatCellText(c, row[c.key])), { zebra: idx % 2 === 1 });
    });
  }
  doc.x = x0;
  doc.fillColor(COLOR_TEXT);
}

function generatePdf(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape', bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('base', FONT_REGULAR);
    doc.registerFont('base-bold', FONT_BOLD);

    doc.rect(0, 0, doc.page.width, 8).fill(COLOR_ACCENT);
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top + 4;

    doc.font('base-bold').fontSize(16).fillColor(COLOR_TEXT).text(model.title, doc.x, doc.y);
    doc.font('base').fontSize(10).fillColor(COLOR_TEXT_SECONDARY);
    if (model.pipelineName) { doc.x = doc.page.margins.left; doc.text('Воронка: ' + model.pipelineName, doc.x, doc.y); }
    if (model.meta.periodLabel) { doc.x = doc.page.margins.left; doc.text('Период: ' + model.meta.periodLabel, doc.x, doc.y); }
    if (model.meta.managerNames && model.meta.managerNames.length) { doc.x = doc.page.margins.left; doc.text('Ответственные: ' + model.meta.managerNames.join(', '), doc.x, doc.y); }
    if (model.meta.sourceNames && model.meta.sourceNames.length) { doc.x = doc.page.margins.left; doc.text('Источники: ' + model.meta.sourceNames.join(', '), doc.x, doc.y); }
    if (model.meta.utmCampaigns && model.meta.utmCampaigns.length) { doc.x = doc.page.margins.left; doc.text('utm_campaign: ' + model.meta.utmCampaigns.join(', '), doc.x, doc.y); }
    doc.x = doc.page.margins.left;
    doc.text('Сформирован: ' + new Date().toLocaleString('ru-RU'), doc.x, doc.y);
    doc.fillColor(COLOR_TEXT);
    doc.moveDown();

    model.sections.forEach((section) => {
      // Keep a section's title from being stranded alone at the bottom of a
      // page with its content starting fresh on the next one.
      if (doc.y > doc.page.height - doc.page.margins.bottom - 60) {
        doc.addPage();
      }
      doc.moveDown(0.6);
      // drawStyledTable/drawFunnelBars/drawTileGrid all position every
      // element at an explicit x/y, which leaves pdfkit's internal cursor
      // wherever the last one landed — reset it before any flowing
      // (no-explicit-x) text, or the next title renders pushed to the right.
      doc.x = doc.page.margins.left;
      doc.font('base-bold').fontSize(12).fillColor(COLOR_ACCENT).text(section.title, doc.page.margins.left, doc.y);
      const ruleY = doc.y + 2;
      doc.moveTo(doc.page.margins.left, ruleY)
        .lineTo(doc.page.width - doc.page.margins.right, ruleY)
        .lineWidth(1.2)
        .strokeColor(COLOR_ACCENT)
        .stroke();
      doc.y = ruleY + 8;
      doc.fillColor(COLOR_TEXT);

      if (section.kind === 'kv') {
        drawTileGrid(doc, section.rows);
        return;
      }
      if (section.id === 'funnel') {
        drawFunnelBars(doc, section.rows);
        return;
      }
      drawStyledTable(doc, section.columns, section.rows);
    });

    doc.end();
  });
}

function setCellValueAndFormat(cell, type, value) {
  if (type === 'date') {
    cell.value = value ? new Date(value * 1000) : null;
    cell.numFmt = 'dd.mm.yyyy';
  } else if (type === 'currency') {
    cell.value = value == null ? null : value;
    cell.numFmt = '#,##0 "₽"';
  } else if (type === 'percent') {
    cell.value = value == null ? null : value;
    cell.numFmt = '0.00"%"';
  } else if (type === 'days') {
    cell.value = value == null ? null : value;
    cell.numFmt = '0.0" дн."';
  } else if (type === 'number') {
    cell.value = value == null ? null : value;
    cell.numFmt = '#,##0';
  } else {
    cell.value = value == null ? '' : String(value);
  }
}

function writeTableBlock(sheet, startRow, columns, rows) {
  let r = startRow;
  columns.forEach((col, i) => {
    const cell = sheet.getRow(r).getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true };
  });
  r += 1;
  if (!rows.length) {
    sheet.getRow(r).getCell(1).value = 'Нет данных за выбранный период';
    r += 1;
    return r;
  }
  rows.forEach((row) => {
    columns.forEach((col, i) => {
      setCellValueAndFormat(sheet.getRow(r).getCell(i + 1), col.type, row[col.key]);
    });
    r += 1;
  });
  return r;
}

// Sheet names are capped at 31 chars and can't contain \/*?:[] — trims and
// strips those out so a table title always produces a valid tab name.
function sheetNameFor(title) {
  const cleaned = String(title).replace(/[\\/*?:[\]]/g, '');
  return cleaned.slice(0, 31) || 'Лист';
}

// Everything on one sheet, sections stacked top to bottom in dashboard
// order — quicker to open and scan than hunting across tabs, at the cost
// of more scrolling for the bigger tables.
async function generateXlsx(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Анализ лидов';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetNameFor('Отчёт'));
  let row = 1;
  sheet.getRow(row).getCell(1).value = model.title;
  sheet.getRow(row).getCell(1).font = { bold: true, size: 14 };
  row += 2;
  if (model.pipelineName) { sheet.getRow(row).getCell(1).value = 'Воронка: ' + model.pipelineName; row += 1; }
  if (model.meta.periodLabel) { sheet.getRow(row).getCell(1).value = 'Период: ' + model.meta.periodLabel; row += 1; }
  if (model.meta.managerNames && model.meta.managerNames.length) { sheet.getRow(row).getCell(1).value = 'Ответственные: ' + model.meta.managerNames.join(', '); row += 1; }
  if (model.meta.sourceNames && model.meta.sourceNames.length) { sheet.getRow(row).getCell(1).value = 'Источники: ' + model.meta.sourceNames.join(', '); row += 1; }
  if (model.meta.utmCampaigns && model.meta.utmCampaigns.length) { sheet.getRow(row).getCell(1).value = 'utm_campaign: ' + model.meta.utmCampaigns.join(', '); row += 1; }
  sheet.getRow(row).getCell(1).value = 'Сформирован: ' + new Date().toLocaleString('ru-RU');
  row += 2;

  model.sections.forEach((section) => {
    sheet.getRow(row).getCell(1).value = section.title;
    sheet.getRow(row).getCell(1).font = { bold: true, size: 12 };
    row += 1;
    if (section.kind === 'kv') {
      section.rows.forEach((r) => {
        sheet.getRow(row).getCell(1).value = r.label;
        setCellValueAndFormat(sheet.getRow(row).getCell(2), r.type, r.value);
        row += 1;
      });
    } else {
      row = writeTableBlock(sheet, row, section.columns, section.rows);
    }
    row += 1;
  });

  sheet.columns.forEach((col) => { col.width = 26; });
  sheet.getColumn(1).width = 40;

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildReportModel, generatePdf, generateXlsx };
