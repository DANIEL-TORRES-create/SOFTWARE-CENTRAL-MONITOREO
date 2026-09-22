/* ARDEPE - Resumen de Central. Agregaciones sobre casos ya cargados (via v2.history), gráficos de
   barras dibujados a mano en SVG (sin librería externa) y exportación a PDF (con pdf-lib, ya usado
   por el resto del sistema) y a Excel (.xlsx, escrito a mano: un zip mínimo sin compresión, válido
   para Excel, sin depender de ninguna librería). No toca el backend ni las demás pantallas. */
(function (root) {
  'use strict';
  const D = root.ArdepeDomain;
  const BRAND = '#a72e26', INK = '#25313b', LINE = '#d9dfe5';
  const REDS = ['#a72e26', '#c4453c', '#dd8480', '#efc0bd', '#f6dedc', '#7c211b', '#8a332c', '#b85a52'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // --- Agregaciones ---
  function countBy(cases, field) {
    const map = new Map();
    cases.forEach(c => { const k = c[field] || 'No informado'; map.set(k, (map.get(k) || 0) + 1); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }
  function ruleLabel(rules, ruleId) { const r = (rules || []).find(x => x.id === ruleId); return r ? (r.customLabel ? r.name : r.name) : ruleId; }
  function countByRule(cases, rules) {
    const map = new Map();
    cases.forEach(c => { (c.events && c.events.length ? c.events.map(e => e.ruleId) : [c.ruleId]).filter(Boolean).forEach(id => { const label = ruleLabel(rules, id) || id; map.set(label, (map.get(label) || 0) + 1); }); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }
  function countByDay(cases) {
    const map = new Map();
    cases.forEach(c => { const day = D.limaDay(c.occurredAt); map.set(day, (map.get(day) || 0) + 1); });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }
  function avgCloseByPriority(cases) {
    return D.PRIORITIES.map(p => {
      const rows = cases.filter(c => c.priority === p && c.finalizedAt);
      const avg = rows.length ? Math.round(rows.reduce((s, c) => s + D.seconds(c.occurredAt, c.finalizedAt), 0) / rows.length / 60) : 0;
      return [p, avg];
    }).filter(r => r[1] > 0 || true);
  }
  function monthlyTrend(allCasesByMonthFetcher) { return allCasesByMonthFetcher; } // se resuelve fuera (necesita red)

  function applyFilters(cases, filters) {
    return cases.filter(c =>
      (!filters.driverId || c.driverId === filters.driverId) &&
      (!filters.plate || c.plate === filters.plate) &&
      (!filters.type || c.type === filters.type) &&
      (!filters.cause || c.cause === filters.cause) &&
      (!filters.result || c.result === filters.result)
    );
  }

  function totals(cases) {
    const total = cases.length, done = cases.filter(c => c.status === 'FINALIZADA').length;
    const avgStart = total ? Math.round(cases.reduce((s, c) => s + D.seconds(c.occurredAt, c.startedAt || c.occurredAt), 0) / total / 60) : 0;
    const closed = cases.filter(c => c.finalizedAt);
    const avgClose = closed.length ? Math.round(closed.reduce((s, c) => s + D.seconds(c.occurredAt, c.finalizedAt), 0) / closed.length / 60) : 0;
    return { total, done, active: total - done, avgStart, avgClose };
  }

  // --- Gráfico de barras en SVG, tamaño fijo, con scroll horizontal si hace falta ---
  function barChartSVG(rows, opts) {
    opts = opts || {};
    const w = 40, gap = 14, top = 16, bottom = 46, height = opts.height || 220;
    const max = Math.max(1, ...rows.map(r => r[1]));
    const chartW = Math.max(opts.minWidth || 420, rows.length * (w + gap) + gap);
    const scale = (height - top - bottom) / max;
    const bars = rows.map((r, i) => {
      const x = gap + i * (w + gap), barH = Math.round(r[1] * scale), y = height - bottom - barH;
      const color = REDS[i % REDS.length];
      const label = String(r[0]).length > 14 ? String(r[0]).slice(0, 13) + '…' : String(r[0]);
      return '<g>' +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + Math.max(1, barH) + '" fill="' + color + '" rx="2"></rect>' +
        '<text x="' + (x + w / 2) + '" y="' + (y - 5) + '" font-size="11" fill="' + INK + '" text-anchor="middle">' + esc(r[1]) + '</text>' +
        '<text x="' + (x + w / 2) + '" y="' + (height - bottom + 14) + '" font-size="10" fill="' + INK + '" text-anchor="middle" transform="rotate(20 ' + (x + w / 2) + ' ' + (height - bottom + 14) + ')">' + esc(label) + '</text>' +
        '</g>';
    }).join('');
    return '<svg width="' + chartW + '" height="' + height + '" viewBox="0 0 ' + chartW + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' +
      '<line x1="0" y1="' + (height - bottom) + '" x2="' + chartW + '" y2="' + (height - bottom) + '" stroke="' + LINE + '"></line>' + bars + '</svg>';
  }

  function tableHTML(rows, headers) {
    if (!rows.length) return '<p class="muted" style="padding:16px">Sin registros</p>';
    const max = Math.max(1, ...rows.map(r => r[1]));
    return '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr>' + headers.map(h => '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid ' + LINE + ';position:sticky;top:0;background:#fff">' + esc(h) + '</th>').join('') + '</tr></thead>' +
      '<tbody>' + rows.map(r => '<tr><td style="padding:5px 8px;border-bottom:1px solid ' + LINE + '">' + esc(r[0]) +
        '<div style="background:' + BRAND + '22;height:4px;border-radius:2px;margin-top:3px;width:' + Math.max(4, Math.round(r[1] / max * 100)) + '%"></div></td>' +
        '<td style="padding:5px 8px;border-bottom:1px solid ' + LINE + ';text-align:right">' + esc(r[1]) + '</td></tr>').join('') +
      '</tbody></table>';
  }

  // --- Exportar PDF: reutiliza pdf-lib, ya cargado por el sistema (window.PDFLib) ---
  async function exportPDF(payload) {
    const { PDFDocument, StandardFonts, rgb } = root.PDFLib;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    pdf.setTitle('ARDEPE - Resumen'); pdf.setCreationDate(new Date());
    const width = 595.28, height = 841.89, margin = 44, available = width - margin * 2;
    let page = pdf.addPage([width, height]), y = height - margin;
    function space(n) { if (y - n < 48) { page = pdf.addPage([width, height]); y = height - margin; } }
    function text(value, opt) { opt = opt || {}; const size = opt.size || 10, f = opt.strong ? bold : font, color = opt.color || rgb(.15, .19, .23); space(size + 6); page.drawText(String(value), { x: margin, y, font: f, size, color }); y -= size + 6; }
    function heading(value) { space(30); y -= 6; text(value, { strong: true, size: 13, color: rgb(.65, .18, .15) }); }
    text('ARDEPE · Resumen de atenciones', { strong: true, size: 16, color: rgb(.65, .18, .15) });
    text(payload.periodLabel);
    if (payload.filterLabel) text('Filtros: ' + payload.filterLabel, { size: 9 });
    text('Generado: ' + new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }), { size: 9 });
    heading('Totales del período');
    text('Total de casos: ' + payload.totals.total + '   Finalizados: ' + payload.totals.done + '   Activos: ' + payload.totals.active);
    text('Promedio hasta iniciar: ' + payload.totals.avgStart + ' min   Promedio hasta finalizar: ' + payload.totals.avgClose + ' min');
    for (const section of payload.sections) {
      if (!section.rows.length) continue;
      heading(section.title);
      if (section.kind === 'table') {
        for (const r of section.rows) text(r[0] + ': ' + r[1], { size: 9 });
      } else {
        for (const r of section.rows) text(r[0] + ': ' + r[1], { size: 9 });
      }
    }
    const pages = pdf.getPages();
    pages.forEach((p, i) => p.drawText('ARDEPE - Resumen - ' + (i + 1) + ' / ' + pages.length, { x: margin, y: 25, font, size: 9, color: rgb(.4, .4, .4) }));
    return pdf.save();
  }

  // --- Exportar Excel (.xlsx): zip mínimo sin compresión (método STORE), válido para Excel ---
  function crc32(bytes) {
    let c, crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c = (crc ^ bytes[i]) & 0xFF;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function strToBytes(s) { return new TextEncoder().encode(s); }
  function u16(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
  function u32(n) { return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF]; }
  function dosTime() { return [0, 0]; } // fecha fija: no afecta la validez del archivo
  function dosDate() { return [0x21, 0x00]; }

  function buildZip(files) {
    // files: [{name, data(Uint8Array)}]. Método 0 = sin comprimir (STORE); Excel lo acepta.
    const chunks = []; let offset = 0; const central = [];
    for (const f of files) {
      const nameBytes = strToBytes(f.name), crc = crc32(f.data);
      const localHeader = new Uint8Array([
        ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...dosTime(), ...dosDate(),
        ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(nameBytes.length), ...u16(0)
      ]);
      chunks.push(localHeader, nameBytes, f.data);
      central.push({ nameBytes, crc, size: f.data.length, offset });
      offset += localHeader.length + nameBytes.length + f.data.length;
    }
    const centralStart = offset; const centralChunks = [];
    for (const c of central) {
      const header = new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...dosTime(), ...dosDate(),
        ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)
      ]);
      centralChunks.push(header, c.nameBytes);
      offset += header.length + c.nameBytes.length;
    }
    const centralSize = offset - centralStart;
    const end = new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(centralSize), ...u32(centralStart), ...u16(0)
    ]);
    const total = chunks.reduce((s, c) => s + c.length, 0) + centralChunks.reduce((s, c) => s + c.length, 0) + end.length;
    const out = new Uint8Array(total); let p = 0;
    [...chunks, ...centralChunks, end].forEach(c => { out.set(c, p); p += c.length; });
    return out;
  }

  function colLetter(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function xmlEsc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

  function sheetXML(headers, rows) {
    const cellsRow = (vals, r, styleHeader) => '<row r="' + r + '">' + vals.map((v, i) => {
      const ref = colLetter(i) + r;
      if (typeof v === 'number') return '<c r="' + ref + '"' + (styleHeader ? ' s="1"' : '') + '><v>' + v + '</v></c>';
      return '<c r="' + ref + '" t="inlineStr"' + (styleHeader ? ' s="1"' : '') + '><is><t>' + xmlEsc(v) + '</t></is></c>';
    }).join('') + '</row>';
    const body = [cellsRow(headers, 1, true)].concat(rows.map((r, i) => cellsRow(r, i + 2, false))).join('');
    const lastCol = colLetter(headers.length - 1);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><pageSetUpPr/></sheetPr>' +
      '<dimension ref="A1:' + lastCol + (rows.length + 1) + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + headers.map((h, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.max(12, String(h).length + 4) + '" customWidth="1"/>').join('') + '</cols>' +
      '<sheetData>' + body + '</sheetData></worksheet>';
  }
  const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFA72E26"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
    '</styleSheet>';

  async function exportExcel(sheets) {
    // sheets: [{name, headers:[...], rows:[[...]]}], solo se incluyen las que tengan filas.
    const usable = sheets.filter(s => s.rows.length);
    if (!usable.length) return null;
    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      usable.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '</Types>';
    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      usable.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (usable.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + usable.map((s, i) => '<sheet name="' + xmlEsc(s.name).slice(0, 31) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>';
    const files = [
      { name: '[Content_Types].xml', data: strToBytes(contentTypes) },
      { name: '_rels/.rels', data: strToBytes(rootRels) },
      { name: 'xl/workbook.xml', data: strToBytes(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: strToBytes(wbRels) },
      { name: 'xl/styles.xml', data: strToBytes(STYLES_XML) },
    ];
    usable.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: strToBytes(sheetXML(s.headers, s.rows)) }));
    return buildZip(files);
  }

  root.ArdepeResumen = { countBy, countByRule, countByDay, avgCloseByPriority, applyFilters, totals, barChartSVG, tableHTML, exportPDF, exportExcel, ruleLabel };
})(typeof window === 'undefined' ? globalThis : window);
