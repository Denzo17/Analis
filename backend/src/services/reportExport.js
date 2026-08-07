const path = require('path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const FONT_REGULAR = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

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
      { stage: 'Новые лиды', value: overall.newCount, share: null },
      { stage: 'Ключевой этап', value: overall.keyCount, share: null },
      { stage: 'Продажи', value: overall.saleCount, share: null },
      { stage: 'Отказ', value: overall.lostCount, share: lostShare }
    ];
    (dashboard.lossReasons || []).forEach((r) => {
      funnelRows.push({
        stage: '  ' + r.label,
        value: r.value,
        share: overall.lostCount ? (r.value / overall.lostCount) * 100 : 0
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

function generatePdf(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape', bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('base', FONT_REGULAR);
    doc.registerFont('base-bold', FONT_BOLD);

    doc.font('base-bold').fontSize(16).fillColor('#000').text(model.title);
    doc.font('base').fontSize(10).fillColor('#555');
    if (model.pipelineName) doc.text('Воронка: ' + model.pipelineName);
    if (model.meta.periodLabel) doc.text('Период: ' + model.meta.periodLabel);
    if (model.meta.managerNames && model.meta.managerNames.length) doc.text('Ответственные: ' + model.meta.managerNames.join(', '));
    if (model.meta.sourceNames && model.meta.sourceNames.length) doc.text('Источники: ' + model.meta.sourceNames.join(', '));
    if (model.meta.utmCampaigns && model.meta.utmCampaigns.length) doc.text('utm_campaign: ' + model.meta.utmCampaigns.join(', '));
    doc.text('Сформирован: ' + new Date().toLocaleString('ru-RU'));
    doc.fillColor('#000');
    doc.moveDown();

    model.sections.forEach((section) => {
      // Keep a section's title from being stranded alone at the bottom of a
      // page with its table starting fresh on the next one.
      if (doc.y > doc.page.height - doc.page.margins.bottom - 60) {
        doc.addPage();
      }
      doc.moveDown(0.5);
      // drawRow below positions every cell at an explicit x/y, which leaves
      // pdfkit's internal cursor wherever the last cell landed — reset it
      // to the left margin before any flowing (no-explicit-x) text, or
      // titles/kv rows after a table section render pushed to the right.
      doc.x = doc.page.margins.left;
      doc.font('base-bold').fontSize(12).text(section.title, doc.page.margins.left, doc.y);
      doc.moveDown(0.3);

      if (section.kind === 'kv') {
        doc.font('base').fontSize(9);
        section.rows.forEach((row) => {
          doc.x = doc.page.margins.left;
          doc.text(row.label + ': ' + formatCellText({ type: row.type }, row.value), doc.page.margins.left, doc.y);
        });
        return;
      }

      const columns = section.columns;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidth = pageWidth / columns.length;
      const rowHeight = 14;

      function drawRow(cells, bold) {
        if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
        }
        const y = doc.y;
        let x = doc.page.margins.left;
        doc.font(bold ? 'base-bold' : 'base').fontSize(8);
        columns.forEach((col, i) => {
          doc.text(String(cells[i]), x, y, { width: colWidth - 4, height: rowHeight, ellipsis: true, lineBreak: false });
          x += colWidth;
        });
        doc.y = y + rowHeight;
      }

      drawRow(columns.map((c) => c.label), true);
      if (!section.rows.length) {
        drawRow(['Нет данных за выбранный период'].concat(columns.slice(1).map(() => '')), false);
      }
      section.rows.forEach((row) => {
        drawRow(columns.map((c) => formatCellText(c, row[c.key])), false);
      });
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

async function generateXlsx(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Анализ лидов';
  workbook.created = new Date();

  const infoSheet = workbook.addWorksheet(sheetNameFor('Показатели'));
  let row = 1;
  infoSheet.getRow(row).getCell(1).value = model.title;
  infoSheet.getRow(row).getCell(1).font = { bold: true, size: 14 };
  row += 2;
  if (model.pipelineName) { infoSheet.getRow(row).getCell(1).value = 'Воронка: ' + model.pipelineName; row += 1; }
  if (model.meta.periodLabel) { infoSheet.getRow(row).getCell(1).value = 'Период: ' + model.meta.periodLabel; row += 1; }
  if (model.meta.managerNames && model.meta.managerNames.length) { infoSheet.getRow(row).getCell(1).value = 'Ответственные: ' + model.meta.managerNames.join(', '); row += 1; }
  if (model.meta.sourceNames && model.meta.sourceNames.length) { infoSheet.getRow(row).getCell(1).value = 'Источники: ' + model.meta.sourceNames.join(', '); row += 1; }
  if (model.meta.utmCampaigns && model.meta.utmCampaigns.length) { infoSheet.getRow(row).getCell(1).value = 'utm_campaign: ' + model.meta.utmCampaigns.join(', '); row += 1; }
  infoSheet.getRow(row).getCell(1).value = 'Сформирован: ' + new Date().toLocaleString('ru-RU');
  row += 2;

  model.sections.filter((s) => s.kind === 'kv').forEach((section) => {
    infoSheet.getRow(row).getCell(1).value = section.title;
    infoSheet.getRow(row).getCell(1).font = { bold: true };
    row += 1;
    section.rows.forEach((r) => {
      infoSheet.getRow(row).getCell(1).value = r.label;
      setCellValueAndFormat(infoSheet.getRow(row).getCell(2), r.type, r.value);
      row += 1;
    });
    row += 1;
  });

  const funnelSection = model.sections.find((s) => s.id === 'funnel');
  if (funnelSection) {
    infoSheet.getRow(row).getCell(1).value = funnelSection.title;
    infoSheet.getRow(row).getCell(1).font = { bold: true };
    row += 1;
    row = writeTableBlock(infoSheet, row, funnelSection.columns, funnelSection.rows);
  }
  infoSheet.columns.forEach((col) => { col.width = 32; });
  infoSheet.getColumn(1).width = 42;

  model.sections
    .filter((s) => s.kind === 'table' && s.id !== 'funnel')
    .forEach((section) => {
      const sheet = workbook.addWorksheet(sheetNameFor(section.title));
      const headerRow = sheet.getRow(1);
      section.columns.forEach((col, i) => {
        headerRow.getCell(i + 1).value = col.label;
        headerRow.getCell(i + 1).font = { bold: true };
      });
      section.rows.forEach((r, idx) => {
        const excelRow = sheet.getRow(idx + 2);
        section.columns.forEach((col, i) => {
          setCellValueAndFormat(excelRow.getCell(i + 1), col.type, r[col.key]);
        });
      });
      section.columns.forEach((col, i) => {
        sheet.getColumn(i + 1).width = Math.max(14, col.label.length + 4);
      });
    });

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildReportModel, generatePdf, generateXlsx };
