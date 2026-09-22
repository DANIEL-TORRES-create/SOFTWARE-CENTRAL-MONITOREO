(function () {
  'use strict';
  const D = window.ArdepeDomain, S = window.ArdepeServices;
  const esc = text => String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const date = value => value ? new Date(value).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const options = (values, selected) => values.map(value => '<option' + (value === selected ? ' selected' : '') + '>' + esc(value) + '</option>').join('');
  const badge = (value, label) => '<span class="badge ' + esc(value) + '">' + esc(label || value) + '</span>';
  const originLabel = value => ({GEOTAB:'Alerta Geotab',CENTRAL:'Solicitud de Central',CONDUCTOR:'Reporte del conductor'})[value] || value || 'Sin origen';
  const channelLabel = value => value==='Drive'?'Geotab Drive':value;
  const bytes = value => Number(value)>=1000000?(Number(value)/1000000).toFixed(1)+' MB':Math.max(1,Math.ceil(Number(value||0)/1000))+' KB';
  class ArdepeUI {
    constructor(role) { this.role = role; this.cases = []; this.events = []; this.page = 0; this.origin = role === 'central' ? 'GEOTAB' : 'NEW'; this.selected = null; this.mode = 'live'; this.pending = new Map(); this.lastMarker = ''; this.activeUntil = 0; this.lastFullRefresh = 0; this.summaryMode = false; this.busyCount = 0; }
    // "Modo activo": tras enviar algo o abrir un caso, consulta más seguido durante 2 minutos.
    noteActivity() { this.activeUntil = Date.now() + 120000; }
    // --- Resumen: estado propio, separado de la cola de casos normal ---
    enterSummary() {
      if (this.role !== 'central' || !this.clearSelection()) return;
      this.summaryMode = true; this.summaryData = null;
      this.$('create').hidden = true; if (this.$('summary-back')) this.$('summary-back').hidden = false;
      this.$('summary').classList.add('active');
      // Se ocultan también la barra de filtros normal (pestañas Geotab/Central/Conductor, estado,
      // prioridad, buscador), las métricas del día y el aviso de límites: en Resumen no aplican.
      ['queue-panel','context-panel','management-panel','filters'].forEach(cls => { const el = document.querySelector('.' + cls); if (el) el.hidden = true; });
      if (this.$('metrics')) this.$('metrics').hidden = true;
      if (this.$('limits-banner')) this.$('limits-banner').hidden = true;
      if (this.$('history-banner')) this.$('history-banner').hidden = true;
      this.$('summary-panel').hidden = false;
      this.pause(); // se pausa el refresco de fondo: cargar el Resumen puede pedir varias páginas seguidas
      this.renderSummaryHint();
    }
    exitSummary() {
      this.summaryMode = false; this.summaryData = null;
      this.$('create').hidden = false; if (this.$('summary-back')) this.$('summary-back').hidden = true;
      this.$('summary').classList.remove('active');
      ['queue-panel','context-panel','management-panel','filters'].forEach(cls => { const el = document.querySelector('.' + cls); if (el) el.hidden = false; });
      if (this.$('metrics')) this.$('metrics').hidden = false;
      if (this.$('limits-banner')) this.$('limits-banner').hidden = false;
      this.$('summary-panel').hidden = true;
      this.resume();
      this.renderList(); this.metrics(); this.renderLimits();
    }
    renderSummaryHint() {
      this.$('summary-content').innerHTML = '<div class="empty"><strong>Seleccione un período en Histórico para ver el resumen.</strong>Elija Hoy, Ayer, Últimos 7 días, o un rango de fechas, y pulse Consultar.</div>';
    }
    async loadSummaryData(from, to, periodLabel) {
      this.$('summary-content').innerHTML = '<div class="empty"><span class="spinner"></span>Consultando…</div>';
      try {
        let cases = [], token = '';
        do { const r = await this.service.history(from, to, token); cases = cases.concat(r.cases); token = r.nextPageToken || ''; } while (token);
        this.summaryData = { from, to, periodLabel, cases, filters: {} };
        // La tendencia de 6 meses se carga una sola vez por sesión de Resumen (no en cada filtro),
        // y usa el mismo conjunto de filtros al momento de dibujarla.
        if (!this.summaryTrendCases) {
          const trendTo = new Date(), trendFrom = new Date(trendTo.getFullYear(), trendTo.getMonth() - 5, 1);
          let trendCases = [], t2 = '';
          try { do { const r = await this.service.history(trendFrom.toISOString(), trendTo.toISOString(), t2); trendCases = trendCases.concat(r.cases); t2 = r.nextPageToken || ''; } while (t2); } catch (_) {}
          this.summaryTrendCases = trendCases;
        }
        this.renderSummaryDashboard();
      } catch (error) { this.$('summary-content').innerHTML = '<div class="empty">' + esc(error.message) + '</div>'; }
    }
    summaryFilterLabel(filters) {
      const parts = [];
      if (filters.driverId) { const c = this.summaryData.cases.find(c => c.driverId === filters.driverId); if (c) parts.push('Conductor: ' + c.driverName); }
      if (filters.plate) parts.push('Vehículo: ' + filters.plate);
      if (filters.type) parts.push('Tipo: ' + filters.type);
      if (filters.cause) parts.push('Causa: ' + filters.cause);
      if (filters.result) parts.push('Resultado: ' + filters.result);
      if (filters.owner) parts.push('Responsable: ' + filters.owner);
      return parts.join(' · ');
    }
    renderSummaryDashboard() {
      const R = window.ArdepeResumen, data = this.summaryData; if (!data || !R) return;
      const cases = R.applyFilters(data.cases, data.filters);
      const trendCases = R.applyFilters(this.summaryTrendCases || [], data.filters);
      const rules = this.rules || [];
      const t = R.totals(cases);
      const driverNames = [...new Map(data.cases.filter(c => c.driverId).map(c => [c.driverId, c.driverName || c.driverId])).entries()];
      const ownerNames = [...new Set((this.people||[]).filter(p=>p.active).map(p=>p.name).concat(data.cases.map(c=>R.lastOwner(c)).filter(Boolean)))];
      const plates = [...new Set(data.cases.map(c => c.plate).filter(Boolean))].sort();
      const groupOptions = { type: ['Tipo', D.TYPES], cause: ['Causa', D.CAUSES], result: ['Resultado', D.RESULTS] };
      const groupField = this.summaryGroup || 'type';
      const groupRows = groupField === 'type' ? R.countBy(cases, 'type') : groupField === 'cause' ? R.countBy(cases, 'cause') : R.countBy(cases, 'result');
      const html =
        '<div class="filter-row" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px">' +
        '<label style="width:160px">Conductor<input id="a-sf-driver" list="a-sf-driver-list" placeholder="Todos" value="' + esc(data.filters.driverId ? (driverNames.find(d=>d[0]===data.filters.driverId)||[,''])[1] : '') + '"><datalist id="a-sf-driver-list">' + driverNames.map(d => '<option value="' + esc(d[1]) + '">').join('') + '</datalist></label>' +
        '<label style="width:140px">Vehículo<input id="a-sf-plate" list="a-sf-plate-list" placeholder="Todos" value="' + esc(data.filters.plate || '') + '"><datalist id="a-sf-plate-list">' + plates.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist></label>' +
        '<label style="width:140px">Tipo<select id="a-sf-type"><option value="">Todos</option>' + D.TYPES.map(x => '<option' + (data.filters.type === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
        '<label style="width:140px">Causa<select id="a-sf-cause"><option value="">Todas</option>' + D.CAUSES.map(x => '<option' + (data.filters.cause === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
        '<label style="width:160px">Resultado<select id="a-sf-result"><option value="">Todos</option>' + D.RESULTS.map(x => '<option' + (data.filters.result === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
        '<label style="width:160px">Responsable<input id="a-sf-owner" list="a-sf-owner-list" placeholder="Todos" value="' + esc(data.filters.owner || '') + '"><datalist id="a-sf-owner-list">' + ownerNames.map(n => '<option value="' + esc(n) + '">').join('') + '</datalist></label>' +
        '<button id="a-sf-apply" class="primary" style="flex:none">Aplicar</button><button id="a-sf-clear" style="flex:none">Limpiar filtros</button>' +
        '</div>' +
        '<div class="export-row" style="display:flex;gap:10px;margin-bottom:14px">' +
        '<button id="a-sf-pdf">Exportar PDF</button><button id="a-sf-xlsx">Exportar Excel</button>' +
        '<small class="muted" style="align-self:center">' + esc(data.periodLabel) + (this.summaryFilterLabel(data.filters) ? ' · ' + esc(this.summaryFilterLabel(data.filters)) : '') + '</small>' +
        '</div>' +
        '<div class="totals" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px">' +
        ['Total de casos,' + t.total, 'Finalizados,' + t.done + ' / ' + t.total, 'Activos,' + t.active, 'Prom. hasta iniciar,' + R.formatMinutes(t.avgStart), 'Prom. hasta finalizar,' + R.formatMinutes(t.avgClose)].map(pair => { const [l,v] = pair.split(','); return '<div class="metric"><small>' + l + '</small><strong>' + v + '</strong></div>'; }).join('') +
        '</div>' +
        '<div class="grid" style="display:flex;flex-wrap:wrap;gap:16px">' +
        this.summaryCard('sf-group', 'Casos por tipo, causa o resultado', '<select id="a-sf-group-sel">' + Object.entries(groupOptions).map(([k,v]) => '<option value="' + k + '"' + (groupField === k ? ' selected' : '') + '>Por ' + v[0].toLowerCase() + '</option>').join('') + '</select>', groupRows.length ? R.barChartSVG(groupRows) : '<p class="muted" style="padding:16px">Sin registros</p>') +
        this.summaryCard('sf-priority', 'Tiempo promedio de cierre por prioridad (HH:MM)', '', (() => { const rows = R.avgCloseByPriority(cases).filter(r=>cases.some(c=>c.priority===r[0])); return rows.length ? R.barChartSVG(rows, { labelFn: r => R.formatMinutes(r[1]) }) : '<p class="muted" style="padding:16px">Sin registros</p>'; })()) +
        this.summaryCard('sf-trend', 'Tendencia mensual · últimos 6 meses', '', (() => { const rows = this.summaryMonthlyRows(trendCases); return rows.length ? R.barChartSVG(rows) : '<p class="muted" style="padding:16px">Sin registros</p>'; })()) +
        this.summaryCard('sf-driver-table', 'Por conductor', '', R.tableHTML(R.countBy(cases, 'driverName'), ['Conductor','Casos'])) +
        this.summaryCard('sf-plate-table', 'Por vehículo', '', R.tableHTML(R.countBy(cases, 'plate'), ['Vehículo','Casos'])) +
        this.summaryCard('sf-rule-table', 'Por regla de Geotab', '', R.tableHTML(R.countByRule(cases, rules), ['Regla','Casos'])) +
        '</div>';
      this.$('summary-content').innerHTML = html;
      const driverMap = new Map(driverNames.map(d => [d[1], d[0]]));
      this.$('sf-apply').onclick = () => {
        const driverText = this.$('sf-driver').value.trim(), plateText = this.$('sf-plate').value.trim(), ownerText = this.$('sf-owner').value.trim();
        data.filters = {
          driverId: driverText ? (driverMap.get(driverText) || '') : '',
          plate: plateText || '',
          type: this.$('sf-type').value || '', cause: this.$('sf-cause').value || '', result: this.$('sf-result').value || '',
          owner: ownerText || '',
        };
        this.renderSummaryDashboard();
      };
      this.$('sf-clear').onclick = () => { data.filters = {}; this.renderSummaryDashboard(); };
      this.$('sf-group-sel').onchange = () => { this.summaryGroup = this.$('sf-group-sel').value; this.renderSummaryDashboard(); };
      this.$('sf-pdf').onclick = () => this.run(this.$('sf-pdf'), stage => this.exportSummaryPDF(cases, trendCases, rules, data, stage));
      this.$('sf-xlsx').onclick = () => this.run(this.$('sf-xlsx'), stage => this.exportSummaryExcel(cases, trendCases, rules, data, stage));
    }
    summaryCard(id, title, control, bodyHtml) {
      return '<div style="width:480px;height:340px;background:#fff;border:1px solid var(--line);border-radius:6px;display:flex;flex-direction:column;overflow:hidden">' +
        '<header style="padding:12px 14px 8px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex:none"><h3 style="margin:0;font-size:13px">' + esc(title) + '</h3>' + control + '</header>' +
        '<div id="a-' + id + '" style="flex:1;overflow:auto;padding:0 14px 14px">' + bodyHtml + '</div></div>';
    }
    summaryMonthlyRows(cases) {
      const now = new Date(), map = new Map();
      for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); map.set(d.toISOString().slice(0,7), d.toLocaleDateString('es-PE', { month:'short', year:'2-digit' })); }
      const counts = new Map([...map.keys()].map(k => [k, 0]));
      cases.forEach(c => { const key = String(c.occurredAt).slice(0,7); if (counts.has(key)) counts.set(key, counts.get(key) + 1); });
      return [...map.keys()].map(k => [map.get(k), counts.get(k)]);
    }
    async exportSummaryPDF(cases, trendCases, rules, data, onProgress) {
      if (!cases.length) throw new Error('No hay datos para exportar con estos filtros');
      if (onProgress) onProgress('Ejecutando…');
      const R = window.ArdepeResumen, t = R.totals(cases);
      const groupField = this.summaryGroup || 'type';
      const bytes = await R.exportPDF({
        periodLabel: data.periodLabel, filterLabel: this.summaryFilterLabel(data.filters), totals: t,
        sections: [
          { title: 'Por ' + R.fieldLabel(groupField).toLowerCase(), rows: groupField === 'type' ? R.countBy(cases,'type') : groupField === 'cause' ? R.countBy(cases,'cause') : R.countBy(cases,'result') },
          { title: 'Tiempo promedio de cierre por prioridad (HH:MM)', rows: R.avgCloseByPriority(cases).filter(r=>cases.some(c=>c.priority===r[0])).map(r=>[r[0], R.formatMinutes(r[1])]) },
          { title: 'Tendencia mensual (6 meses)', rows: this.summaryMonthlyRows(trendCases) },
          { title: 'Por conductor', rows: R.countBy(cases,'driverName') },
          { title: 'Por vehículo', rows: R.countBy(cases,'plate') },
          { title: 'Por regla de Geotab', rows: R.countByRule(cases, rules) },
        ]
      });
      const url = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})), link = document.createElement('a');
      link.href=url;link.download='ARDEPE_resumen_'+D.limaDay(new Date())+'.pdf';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      this.toast('PDF generado');
    }
    async exportSummaryExcel(cases, trendCases, rules, data, onProgress) {
      const R = window.ArdepeResumen;
      if (!cases.length) throw new Error('No hay datos para exportar con estos filtros');
      if (onProgress) onProgress('Ejecutando…');
      const groupField = this.summaryGroup || 'type';
      const bytes = await R.exportExcel([
        { name: 'Resumen', headers: ['Período','Filtros','Total','Finalizados','Activos'], rows: [[data.periodLabel, this.summaryFilterLabel(data.filters)||'Ninguno', cases.length, cases.filter(c=>c.status==='FINALIZADA').length, cases.filter(c=>c.status!=='FINALIZADA').length]] },
        { name: 'Por ' + R.fieldLabel(groupField).toLowerCase(), headers: [R.fieldLabel(groupField),'Casos'], rows: groupField==='type'?R.countBy(cases,'type'):groupField==='cause'?R.countBy(cases,'cause'):R.countBy(cases,'result') },
        { name: 'Cierre por prioridad', headers: ['Prioridad','Tiempo promedio (HH:MM)'], rows: R.avgCloseByPriority(cases).filter(r=>cases.some(c=>c.priority===r[0])).map(r=>[r[0], R.formatMinutes(r[1])]) },
        { name: 'Tendencia 6 meses', headers: ['Mes','Casos'], rows: this.summaryMonthlyRows(trendCases) },
        { name: 'Por conductor', headers: ['Conductor','Casos'], rows: R.countBy(cases,'driverName') },
        { name: 'Por vehículo', headers: ['Vehículo','Casos'], rows: R.countBy(cases,'plate') },
        { name: 'Por regla Geotab', headers: ['Regla','Casos'], rows: R.countByRule(cases, rules) },
      ]);
      if (!bytes) throw new Error('No hay datos para exportar con estos filtros');
      const url = URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})), link = document.createElement('a');
      link.href=url;link.download='ARDEPE_resumen_'+D.limaDay(new Date())+'.xlsx';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      this.toast('Excel generado');
    }
    $(id) { return document.getElementById('a-' + id); }
    async mount(api) {
      this.pause(); this.stopBackgroundNotifications(); this.api = api;
      this.demo = new URLSearchParams(location.search).get('demo') === '1';
      this.service = this.demo ? new S.DemoService(this.role) : api ? (this.role==='driver'&&this.backgroundService||new S.LiveService(api, this.role)) : null;
      const root = document.getElementById('ardepe-root'); if (!root) return;
      root.innerHTML = this.layout(); this.bind(); this.mounted = true;
      if (!this.service) { this.status('Abra esta página en ' + (this.role === 'driver' ? 'Geotab Drive' : 'MyGeotab'), true); this.$('list').innerHTML = '<div class="empty"><strong>Conexión Geotab requerida</strong>Puede revisar la interfaz sin conexiones reales.<br><br><a href="?demo=1">Abrir demostración local</a></div>'; return; }
      try {
        if (!this.demo && !this.service.token) await this.service.connect();
        await this.refresh(); this.resume();
      } catch (error) { this.status(error.message, true); this.toast(error.message, true); }
    }
    async startup(api, state, callback) {
      try{
        this.api=api;this.state=state;this.backgroundService=new S.LiveService(api,'driver');await this.backgroundService.connect();await this.checkDriverNotifications(this.backgroundService);this.startBackgroundNotifications(this.backgroundService);
      }catch(_){}finally{if(callback)callback();}
    }
    async checkDriverNotifications(service) {
      if(!service||this.notificationChecking)return;this.notificationChecking=true;
      try{
        // Antes de la consulta completa, se pregunta la marca liviana: si no cambió desde la
        // última vez, no hace falta traer todos los casos solo para revisar si hay algo nuevo.
        if(typeof service.marker==='function'){
          let marker='';
          try{marker=await service.marker();}catch(_){marker=this.lastBackgroundMarker===undefined?'':undefined;}
          if(marker===this.lastBackgroundMarker)return;
          this.lastBackgroundMarker=marker;
        }
        const data=await service.bootstrap(),unread=(data.cases||[]).filter(c=>c.lastCentralMessageAt>(c.readByDriverAt||'')).length;if(unread){const latest=(data.cases||[]).map(c=>c.lastCentralMessageAt||'').sort().pop();await service.notify('Central ARDEPE',unread===1?'Tiene una solicitud nueva de Monitoreo':'Tiene '+unread+' solicitudes nuevas de Monitoreo',latest);}
      }finally{this.notificationChecking=false;}
    }
    startBackgroundNotifications(service) { this.stopBackgroundNotifications();if(!service||this.role!=='driver')return;this.notificationTimer=setInterval(()=>this.checkDriverNotifications(service).catch(()=>{}),15000); }
    stopBackgroundNotifications() { clearInterval(this.notificationTimer);this.notificationTimer=null; }
    layout() {
      const driver = this.role === 'driver';
      const logo = 'https://daniel-torres-create.github.io/SOFTWARE-CENTRAL-MONITOREO/public/assets/logo.png?v=20260919-2';
      const actions = driver
        ? '<div class="commandbar driver-actions"><select id="a-person" hidden><option value=""></option></select><button id="a-create" class="primary"><span class="action-icon">＋</span><span>Reportar</span></button><button id="a-history"><span class="action-icon">▤</span><span>Historial</span></button><button id="a-guide"><span class="action-icon">?</span><span>Ayuda</span></button></div>'
        : '<div class="commandbar"><div class="operator"><label>Personal activo<select id="a-person"><option value="">Seleccione personal</option></select></label></div><button id="a-history">Histórico</button><button id="a-create" class="primary">Crear caso</button><button id="a-summary-back" hidden>Volver al panel</button><button id="a-guide">Guía</button><button id="a-admin" aria-label="Administración">⚙</button></div>';
      const tabs = (driver ? [['NEW','Nuevos'],['ACTIVE','En curso'],['DONE','Finalizados']] : [['GEOTAB','Alertas Geotab'],['CENTRAL','Solicitudes de Central'],['CONDUCTOR','Reportes del conductor']]).map(([id,label]) => '<button data-origin="' + id + '" class="' + (id === this.origin ? 'active' : '') + '">' + label + '<span class="tab-count" data-origin-count="'+id+'"></span></button>').join('');
      const filters = driver
        ? '<section class="filters driver-filters"><nav class="tabs" id="a-tabs" aria-label="Casos">' + tabs + '</nav><details class="filter-disclosure"><summary>Buscar y filtrar</summary><div class="filter-row"><select id="a-state" aria-label="Estado"><option value="ALL">Todos los estados activos</option><option value="OLD">Pendientes anteriores</option>' + Object.entries(D.STATES).map(([id,label]) => '<option value="' + id + '">' + label + '</option>').join('') + '</select><select id="a-priority" aria-label="Prioridad"><option value="ALL">Todas las prioridades</option>' + options(D.PRIORITIES) + '</select><input id="a-search" type="search" placeholder="Buscar vehículo o motivo" aria-label="Buscar casos"><button id="a-refresh">Actualizar</button></div></details></section>'
        : '<section class="filters"><nav class="tabs" id="a-tabs" aria-label="Origen">' + tabs + '<button id="a-summary" style="margin-left:auto">Resumen</button></nav><div class="filter-row central-filter-row"><select id="a-rule" aria-label="Tipo de alerta"><option value="ALL">Todas las alertas Geotab</option></select><select id="a-state" aria-label="Estado"><option value="ALL">Todos los estados activos</option><option value="OLD">Pendientes anteriores</option>' + Object.entries(D.STATES).map(([id,label]) => '<option value="' + id + '">' + label + '</option>').join('') + '</select><select id="a-priority" aria-label="Prioridad"><option value="ALL">Todas las prioridades</option>' + options(D.PRIORITIES) + '</select><input id="a-search" type="search" placeholder="Buscar placa, conductor o motivo" aria-label="Buscar casos"><input id="a-owner-filter" list="a-owner-filter-list" placeholder="Responsable de seguimiento" aria-label="Filtrar por responsable de seguimiento"><datalist id="a-owner-filter-list"></datalist><button id="a-refresh">Actualizar</button></div></section>';
      return '<div class="shell ' + (driver ? 'driver-shell' : '') + '">' +
        '<header class="topbar"><img class="logo" src="' + logo + '" alt="ARDEPE SAC"><div class="title"><h1>' + (driver ? 'Mis atenciones' : 'Central Integral de Monitoreo') + '</h1><p>ARDEPE · Seguridad vial</p></div>'+(driver?'<button id="a-drive-back" class="drive-back" aria-label="Volver al panel de Geotab Drive" title="Volver a Geotab Drive">←</button>':'')+'<div class="identity"><span id="a-connection" class="connection">Preparando conexión</span><div id="a-identity" class="muted"></div></div></header>' +
        (this.demo ? '<div class="demo-banner"><strong>DEMOSTRACIÓN LOCAL</strong><span>Datos simulados. No envía información real.</span><a target="_blank" href="' + (driver ? 'centralArdepe' : 'conductorArdepe') + '.html?demo=1">Abrir ' + (driver ? 'Central' : 'vista del conductor') + '</a></div>' : '') +
        actions +
        '<section class="metrics" id="a-metrics" aria-label="Resumen"></section>' +
        (driver ? '' : '<div id="a-limits-banner"></div>') +
        filters +
        '<div id="a-history-banner" class="history-banner" hidden><span id="a-history-label"></span><button id="a-live">Volver a activos</button><button id="a-export-all">Exportar consulta</button></div>' +
        '<main class="workspace"><aside class="panel queue-panel"><header class="panel-heading"><h2 id="a-queue-title">' + (driver ? 'Tus atenciones' : 'Cola de atención') + '</h2><small id="a-count">0 casos</small></header><div class="scroll" id="a-list"><div class="empty"><span class="spinner"></span>Consultando…</div></div><div class="pager"><button id="a-prev" aria-label="Página anterior">Anterior</button><span id="a-page"></span><button id="a-next">Siguiente</button></div></aside><section class="panel context-panel"><header class="panel-heading"><h2>Detalle del caso</h2><span class="panel-heading-actions"><span>Información operativa</span><button class="close-view" data-close-view hidden aria-label="Cerrar detalle" title="Cerrar vista">×</button></span></header><div id="a-context" class="scroll"><div class="empty">Seleccione un caso para revisar su contexto.</div></div></section><section class="panel management-panel"><header class="panel-heading"><h2>' + (driver ? 'Detalle y conversación' : 'Atención y conversación') + '</h2><span class="panel-heading-actions"><small id="a-manager"></small><button class="close-view" data-close-view hidden aria-label="Cerrar detalle y conversación" title="Cerrar vista">×</button></span></header><div id="a-work" class="scroll">' + (driver ? '<div class="empty"><strong>Seleccione una atención</strong>Aquí podrá revisar el detalle, conversar y adjuntar evidencias.</div>' : '<div class="operation-start"><h3>Ruta de atención</h3><ol><li><span>1</span>Validar evento y conductor</li><li><span>2</span>Elegir canal de contacto</li><li><span>3</span>Evaluar respuesta y causa</li><li><span>4</span>Registrar acciones y seguimiento</li><li><span>5</span>Finalizar con expediente completo</li></ol><p>Seleccione un caso de la cola o use <b>Crear caso</b> para comenzar.</p></div>') + '</div></section>' + (driver ? '' : '<section class="panel" id="a-summary-panel" hidden style="grid-column:1/-1"><div id="a-summary-content" class="scroll"></div></section>') + '</main></div>' +
        '<dialog id="a-dialog" class="modal"><header><h2 id="a-dialog-title"></h2><button id="a-close" aria-label="Cerrar">×</button></header><div id="a-dialog-body" class="body"></div></dialog><div id="a-toast" class="toast" role="status" hidden></div><div id="a-print" class="print-view"></div>';
    }
    bind() {
      this.$('refresh').onclick = () => this.run(this.$('refresh'), () => this.refresh());
      this.$('tabs').onclick = event => { const button = event.target.closest('[data-origin]'); if (!button || button.dataset.origin===this.origin) return; if(!this.clearSelection())return; this.origin = button.dataset.origin; this.page = 0; this.$('tabs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button)); this.updateRuleFilter(); this.renderList(); };
      ['rule','state','priority','search','owner-filter'].filter(id=>this.$(id)).forEach(id => this.$(id).addEventListener('input', () => { this.page = 0; this.renderList(); }));
      this.$('person').onchange = () => { sessionStorage.setItem('ardepe-person', this.$('person').value); if (this.selected) this.renderWork(); };
      this.$('prev').onclick = () => { this.page = Math.max(0, this.page - 1); this.renderList(); };
      this.$('next').onclick = () => {
        const localPages=Math.max(1,Math.ceil(this.filtered().length/25));
        if(this.mode==='cases'&&this.page>=localPages-1&&this.historyNextToken)return this.run(this.$('next'),async()=>{const result=await this.service.history(this.historyQuery.from,this.historyQuery.to,this.historyNextToken);this.historyRows=this.historyRows.concat(result.cases);this.historyNextToken=result.nextPageToken||'';this.page++;this.renderList();this.metrics();});
        this.page++; this.renderList();
      };
      this.$('close').onclick = () => { this.$('dialog').close();this.clearEvidenceUrl(); };
      this.$('create').onclick = () => this.createDialog(); this.$('history').onclick = () => this.historyDialog();
      if (this.$('summary')) this.$('summary').onclick = () => this.enterSummary();
      if (this.$('summary-back')) this.$('summary-back').onclick = () => this.exitSummary();
      this.$('live').onclick = () => { if(!this.clearSelection())return;this.mode = 'live'; this.$('history-banner').hidden = true; this.$('state').value = 'ALL'; if(this.role==='central'&&this.origin==='ALL')this.origin='GEOTAB';if(this.role==='driver'&&this.origin==='ALL')this.origin='NEW';this.$('tabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.origin===this.origin));this.refresh().catch(e => this.toast(e.message, true)); };
      this.$('guide').onclick = () => this.guide();
      if (this.$('drive-back')) this.$('drive-back').onclick = () => this.goDriveHome();
      this.$('export-all').onclick = () => this.run(this.$('export-all'), stage => this.exportCases(this.filtered().filter(c => c.version), stage));
      if (this.$('admin')) this.$('admin').onclick = () => this.adminDialog();
      document.querySelectorAll('#ardepe-root [data-close-view]').forEach(button=>button.onclick=()=>this.clearSelection());
    }
    status(message, error) { this.$('connection').textContent = message; this.$('connection').className = 'connection' + (error ? ' error' : ''); }
    hideToast(){clearTimeout(this.toastTimer);const toast=this.$('toast');if(toast){toast.hidden=true;toast.textContent='';toast.className='toast';}}
    toast(message, error) { this.hideToast();const toast=this.$('toast');toast.textContent=message;toast.className='toast' + (error ? ' error' : '');toast.hidden=false;this.toastTimer=setTimeout(()=>this.hideToast(),4000); }
    // El botón se queda esperando todo el tiempo que haga falta, sin soltarse solo: así siempre
    // se ve que sigue trabajando, y nunca hace falta volver a hacer clic. Un rechazo real (que
    // necesita tu atención, como "El caso cambió") se avisa; uno incierto por conexión no avisa
    // nada, simplemente sigue reintentando por dentro hasta terminar.
    // Mientras dura, "busyCount" evita que un refresco de fondo reconstruya la pantalla y
    // reemplace el formulario deshabilitado por uno nuevo (lo que hacía que pareciera "liberado"
    // aunque el envío original siguiera trabajando por detrás).
    async run(button, fn) {
      if (button.disabled) return;
      const html = button.innerHTML,stage=label=>{if(button.isConnected)button.innerHTML='<span class="spinner"></span>'+label;};
      button.disabled=true;stage('Procesando…');
      this.busyCount=(this.busyCount||0)+1;
      try{await fn(stage);}
      catch(error){if(!error || !error.uncertain)this.toast(error.message,true);}
      finally{this.busyCount=Math.max(0,(this.busyCount||1)-1);if(button.isConnected){button.disabled=false;button.innerHTML=html;}}
    }
    // "timerGen" evita que se dupliquen las consultas de fondo. Cada pause() (llamado también desde
    // dentro de resume()) sube este número; cualquier cadena de consultas que haya quedado esperando
    // una respuesta de red revisa este número antes de programarse de nuevo, y si ya no coincide, se
    // detiene sola en vez de seguir corriendo en paralelo con la cadena nueva. Antes de este cambio,
    // pausar mientras una consulta seguía en camino no la cancelaba, y al terminar igual se volvía a
    // programar, dejando cadenas duplicadas corriendo para siempre y haciendo el sistema cada vez más
    // lento cuanto más tiempo llevara la pestaña abierta.
    pause() { clearTimeout(this.timer); clearInterval(this.clock); this.timerGen = (this.timerGen || 0) + 1; }
    focus() { this.hideToast();this.stopBackgroundNotifications();this.resume(); }
    blur() { this.hideToast();this.pause();if(this.role==='driver'&&this.service&&!this.demo)this.startBackgroundNotifications(this.service); }
    resume() { if (!this.mounted || !this.service) return; this.pause(); this.scheduleCheck(this.timerGen); this.clock = setInterval(() => this.tick(), 1000); }
    // En vez de un intervalo fijo, se reprograma cada vez con el tiempo que toque: más seguido en
    // modo activo (tras enviar o abrir algo) o mientras se muestra un caso, más espaciado el resto
    // del tiempo. Antes de cada consulta completa se pregunta primero la marca liviana; solo se
    // repite la consulta completa si la marca cambió, o cada 60 s de todas formas como red de
    // seguridad (por si la marca se perdiera de la memoria del servidor).
    scheduleCheck(gen) {
      gen = gen == null ? this.timerGen : gen;
      const active = Date.now() < this.activeUntil || Boolean(this.selected);
      const interval = active ? 3000 : (this.role === 'central' ? 5000 : 15000);
      this.timer = setTimeout(() => {
        if (gen !== this.timerGen) return; // esta cadena quedó obsoleta: hubo un pause()/resume() mientras esperaba
        if (this.mode === 'live') this.checkForChanges()
          .then(() => { this.backgroundFailStreak = 0; })
          // Un solo tropiezo de conexión no se muestra: es normal y se resuelve solo en el próximo
          // ciclo. Solo si ya van varias seguidas fallando se avisa, y con un texto tranquilo, no
          // el mensaje técnico crudo (que puede decir cosas como "fetch is aborted").
          .catch(() => { this.backgroundFailStreak = (this.backgroundFailStreak || 0) + 1; if (this.backgroundFailStreak >= 3) this.status('Actualizando con demora…', true); })
          .finally(() => { if (gen === this.timerGen) this.scheduleCheck(gen); });
        else this.scheduleCheck(gen);
      }, interval);
    }
    async checkForChanges() {
      if (!this.service || this.refreshing) return;
      if (typeof this.service.marker !== 'function') { await this.refresh(); return; }
      const safetyNet = Date.now() - this.lastFullRefresh > 60000;
      let marker = this.lastMarker;
      try { marker = await this.service.marker(); } catch (_) { /* si falla, la red de seguridad igual refresca */ }
      if (safetyNet || marker !== this.lastMarker) { this.lastMarker = marker; await this.refresh(); }
    }
    async refresh() {
      if (!this.service || this.refreshing || this.mode !== 'live') return;
      this.refreshing = true; this.lastFullRefresh = Date.now(); this.status('Actualizando…');
      try {
        const previousUnread=this.role==='driver'?this.cases.filter(c=>this.unread(c)).length:0;
        const queryStart = Date.now(); const data = await this.service.bootstrap(); this.queryMs = Date.now() - queryStart; this.people = data.personnel || []; this.rules = data.rules || []; this.cases = data.cases || []; this.events = data.events || []; this.limits = data.limits || null; this.updateRuleFilter(true);
        const unreadNow=this.role==='driver'?this.cases.filter(c=>this.unread(c)).length:0;
        if(this.role==='driver'&&unreadNow>previousUnread&&previousUnread>=0){const latest=this.cases.map(c=>c.lastCentralMessageAt||'').sort().pop();this.service.notify('Central ARDEPE',unreadNow===1?'Tiene una solicitud nueva de Monitoreo':'Tiene '+unreadNow+' solicitudes nuevas de Monitoreo',latest);}
        this.$('identity').textContent = this.role === 'driver' ? data.actor.name : 'Hora operativa · Lima';
        const old = this.$('person').value || sessionStorage.getItem('ardepe-person');
        this.$('person').innerHTML = '<option value="">Seleccione personal</option>' + this.people.filter(p => p.active).map(p => '<option value="' + esc(p.id) + '">' + esc(p.name + ' · ' + p.area) + '</option>').join('');
        if (this.$('owner-filter-list')) this.$('owner-filter-list').innerHTML = this.people.filter(p => p.active).map(p => '<option value="' + esc(p.name) + '">').join('');
        if (this.people.some(p => p.active && p.id === old)) this.$('person').value = old;
        if (this.demo && !this.$('person').value) this.$('person').value = 'demo-operator';
        this.renderList(); this.metrics(); this.renderLimits();
        if (this.selected && this.selected.version) {
          const fresh = this.cases.find(c => c.id === this.selected.id);
          if (fresh && fresh.version !== this.selected.version) { this.selected = fresh;if(!this.hasDraft()){this.renderContext();this.renderWork(true);} }
        }
        this.status(this.demo ? 'Demostración conectada' : 'Conectado · ' + new Date().toLocaleTimeString('es-PE'));
      } finally { this.refreshing = false; }
    }
    goDriveHome() {
      const mobile=this.api&&this.api.mobile,navigate=mobile&&mobile.navigate;
      if(navigate){try{const result=navigate.call(mobile,'other');if(result&&typeof result.catch==='function')result.catch(()=>history.back());return;}catch(_){}}
      history.back();
    }
    all() {
      if (this.mode !== 'live') return this.historyRows || [];
      const keys = new Set(this.cases.flatMap(c => c.eventKeys));
      return [...this.cases, ...this.events.filter(e => !keys.has(e.eventKey))];
    }
    updateRuleFilter(refreshOptions=false) {
      const select=this.$('rule');
      if(!select)return;
      if(refreshOptions){
        const previous=select.value;
        select.innerHTML='<option value="ALL">Todas las alertas Geotab</option>'+(this.rules||[]).filter(rule=>rule.active&&rule.show!==false).map(rule=>'<option value="'+esc(rule.id)+'">'+esc(rule.name)+'</option>').join('');
        if([...select.options].some(option=>option.value===previous))select.value=previous;
      }
      select.hidden=this.origin!=='GEOTAB';
      if(select.hidden)select.value='ALL';
    }
    filtered() {
      const rule = this.$('rule') ? this.$('rule').value : 'ALL', state = this.$('state').value, priority = this.$('priority').value, query = this.$('search').value.toLocaleLowerCase(), ownerQuery = this.$('owner-filter') ? this.$('owner-filter').value.trim().toLocaleLowerCase() : '', today = D.limaDay(new Date());
      return this.all().filter(c => {
        if (this.role === 'driver' && c.driverId !== this.service.actor.id) return false;
        if (this.role === 'driver') { if (this.origin !== 'ALL' && this.driverBucket(c) !== this.origin) return false; }
        else {
          if (this.origin === 'DONE' && c.status !== 'FINALIZADA') return false;
          if (this.origin === 'NEW' && !this.unread(c)) return false;
          if (!['ALL','DONE','NEW'].includes(this.origin) && c.origin !== this.origin) return false;
        }
        if (state === 'ALL' && this.mode === 'live' && this.origin !== 'DONE' && c.status === 'FINALIZADA') return false;
        if (state === 'OLD' && (c.status === 'FINALIZADA' || D.limaDay(c.occurredAt) >= today)) return false;
        if (!['ALL','OLD'].includes(state) && c.status !== state) return false;
        if (priority !== 'ALL' && c.priority !== priority) return false;
        if (rule !== 'ALL' && ![c.ruleId,c.rule&&c.rule.id,...(c.events||[]).map(event=>event.ruleId)].includes(rule)) return false;
        if (ownerQuery && !(this.lastOwner(c) || '').toLocaleLowerCase().includes(ownerQuery)) return false;
        return !query || [c.title,c.plate,c.driverName,c.location].join(' ').toLocaleLowerCase().includes(query);
      }).sort((a,b) => D.PRIORITIES.indexOf(a.priority) - D.PRIORITIES.indexOf(b.priority) || a.occurredAt.localeCompare(b.occurredAt));
    }
    unread(c) { return this.role === 'driver' ? c.lastCentralMessageAt > (c.readByDriverAt || '') : c.lastDriverMessageAt > (c.readByCentralAt || ''); }
    // Pestañas del conductor: Nuevos = mensaje de Monitoreo que el conductor nunca abrió (un reporte
    // propio del conductor nunca pasa por aquí). En curso = ya se abrió una vez, o lo reportó el
    // conductor mismo; una vez aquí, no vuelve a Nuevos aunque llegue otro mensaje. Finalizados = cerrado.
    driverBucket(c) { if (c.status === 'FINALIZADA') return 'DONE'; if (c.origin !== 'CONDUCTOR' && !c.readByDriverAt) return 'NEW'; return 'ACTIVE'; }
    // El responsable "vigente" de un caso es el de su gestión más reciente, la misma que ya se usa
    // para prellenar y heredar datos en "Actualizar seguimiento".
    lastOwner(c) { return (c.managements && c.managements.length) ? c.managements[c.managements.length - 1].owner || '' : ''; }
    // Para el conductor: si el último mensaje de Central no pedía respuesta y el conductor todavía
    // no contestó nada después de ese mensaje, se le ofrece solo confirmar que lo recibió, en vez
    // de un cuadro de texto. Aplica igual al primer mensaje de un caso creado por Central o desde
    // un evento Geotab, ya que ese mensaje inicial también pasa por aquí como "último de Central".
    needsOnlyConfirmation(c) {
      if (this.role !== 'driver') return false;
      const centralMsgs = (c.messages || []).filter(m => m.role === 'central');
      if (!centralMsgs.length) return false;
      const last = centralMsgs[centralMsgs.length - 1];
      if (last.requiresResponse) return false;
      return !(c.messages || []).some(m => m.role === 'driver' && m.at > last.at);
    }
    // Busca la regla asociada a un caso o evento (por el primer evento, o por ruleId directo para
    // casos antiguos), para usar su nombre de dato personalizado si tiene uno ("Ralentí", etc.)
    // en vez del genérico "Valor detectado". Si no encuentra la regla, usa el genérico de siempre.
    measurementRule(c) { const ruleId = c.ruleId || (c.events && c.events[0] && c.events[0].ruleId); return ruleId ? (this.rules||[]).find(r => r.id === ruleId) : null; }
    measurementLabel(c) { const rule = this.measurementRule(c); return (rule && rule.customLabel) || 'Valor detectado'; }
    measurementText(c) { const rule = this.measurementRule(c); if (rule && rule.kind === 'none') return c.measurement ? 'Solo alerta' : 'No disponible'; return c.measurement && c.measurement.text || 'No disponible'; }
    hasDraft(){if(this.busyCount>0)return true;const work=this.$('work');if(!work)return false;return work.dataset.dirty==='1'||[...work.querySelectorAll('textarea')].some(el=>el.value.trim())||[...work.querySelectorAll('input[type=file]')].some(el=>el.files&&el.files.length);}
    clearSelection(force=false) {
      if(this.selected&&!force&&this.hasDraft()&&!window.confirm('Hay información sin enviar. ¿Desea cerrar la vista y descartarla?'))return false;
      this.selected=null;const shell=document.querySelector('.driver-shell');if(shell)shell.classList.remove('case-open');
      this.$('context').innerHTML='<div class="empty">Seleccione un caso para revisar su contexto.</div>';this.$('manager').textContent='';
      this.$('work').innerHTML=this.role==='driver'?'<div class="empty"><strong>Seleccione una atención</strong>Aquí podrá revisar el detalle, conversar y adjuntar evidencias.</div>':'<div class="operation-start"><h3>Ruta de atención</h3><ol><li><span>1</span>Validar evento y conductor</li><li><span>2</span>Elegir canal de contacto</li><li><span>3</span>Evaluar respuesta y causa</li><li><span>4</span>Registrar acciones y seguimiento</li><li><span>5</span>Finalizar con expediente completo</li></ol><p>Seleccione un caso de la cola o use <b>Crear caso</b> para comenzar.</p></div>';
      document.querySelectorAll('#ardepe-root [data-close-view]').forEach(button=>button.hidden=true);this.renderList();return true;
    }
    renderList() {
      const rows = this.filtered(), pages = Math.max(1, Math.ceil(rows.length / 25)); this.page = Math.min(this.page, pages - 1);
      if(this.selected&&!rows.some(row=>row.id===this.selected.id)&&!this.hasDraft()){this.clearSelection(true);return;}
      this.$('count').textContent = rows.length + ' casos'; this.$('page').textContent = (this.page + 1) + ' / ' + pages;
      this.$('prev').disabled = this.page === 0; this.$('next').disabled = this.page >= pages - 1 && !(this.mode==='cases'&&this.historyNextToken);
      this.$('page').parentElement.hidden=pages<=1&&!(this.mode==='cases'&&this.historyNextToken);
      const all=this.all(),active=c=>this.mode!=='live'||c.status!=='FINALIZADA';this.$('tabs').querySelectorAll('[data-origin-count]').forEach(node=>{const id=node.dataset.originCount;let count;if(this.role==='driver')count=all.filter(c=>this.driverBucket(c)===id).length;else count=all.filter(c=>c.origin===id&&active(c)).length;node.textContent=String(count);
        // Se resalta cada pestaña cuando tiene algo nuevo sin leer: para el conductor, un mensaje de
        // Central en un caso de esa pestaña; para Central, una respuesta del conductor en un caso de
        // ese origen (Geotab, Central o Conductor), no solo en "Reportes del conductor" como antes.
        const hasUnread = this.role==='driver' ? all.some(c=>this.driverBucket(c)===id&&this.unread(c)) : all.some(c=>c.origin===id&&this.unread(c));
        node.classList.toggle('attention',this.role==='driver'&&id==='NEW'&&count>0||hasUnread);});
      const ready = (this.people||[]).some(p=>p.active) && (this.rules||[]).some(r=>r.active);
      const empty = this.mode === 'live'
        ? (this.role === 'driver' ? '<div class="empty app-empty"><span class="empty-mark">✓</span><strong>Todo está al día</strong>No tienes solicitudes ni casos activos.<br>Usa <b>Reportar</b> si necesitas informar un incidente.</div>' : ready ? '<div class="empty app-empty"><span class="empty-mark">✓</span><strong>Sin casos en esta bandeja</strong>Revise las otras bandejas o use <b>Crear caso</b>.</div>' : '<div class="empty setup-empty"><strong>Complete la configuración inicial</strong><ol><li>Abra Administración.</li><li>Registre el personal de Monitoreo.</li><li>Registre y active las reglas Geotab.</li><li>Seleccione el personal activo y actualice la bandeja.</li></ol><span>Esta implementación inicia sin registros anteriores.</span></div>')
        : '<div class="empty app-empty"><span class="empty-mark">○</span><strong>Sin registros nuevos</strong>No existen atenciones de esta implementación en el periodo consultado.</div>';
      this.$('list').innerHTML = rows.length ? rows.slice(this.page * 25, this.page * 25 + 25).map(c => {const minutes=Number(this.service.settings&&this.service.settings.priorityMinutes&&this.service.settings.priorityMinutes[c.priority]),alert=c.status!=='FINALIZADA'&&minutes>0&&D.seconds(c.occurredAt,new Date().toISOString())>=minutes*60;return '<button class="queue-row ' + (this.selected && this.selected.id === c.id ? 'selected ' : '')+(alert?'overdue':'')+'" data-case="' + esc(c.id) + '"><div class="row-head"><strong>' + esc(c.plate || c.type || 'Caso') + '</strong>' + badge(c.priority) + '</div>'+(this.role==='central'?'<span class="origin-chip '+esc(c.origin)+'">'+esc(originLabel(c.origin))+'</span>':'')+'<p>' + esc(c.title) + '</p><small>' + esc(c.driverName || 'Conductor por confirmar') + '</small><div class="meta">' + badge(c.status, D.STATES[c.status]) + '<small>' + (alert?'Alerta operativa · ':this.unread(c)?'Mensaje nuevo · ':'') + date(c.occurredAt) + '</small></div></button>';}).join('') : empty;
      this.$('list').querySelectorAll('[data-case]').forEach(button => button.onclick = () => this.run(button, () => this.select(rows.find(c => c.id === button.dataset.case))));
    }
    metrics() {
      const rows = this.all(), open = rows.filter(c => c.status !== 'FINALIZADA'), now = new Date().toISOString();
      const list = [ ['Por gestionar', open.filter(c => c.status === 'NUEVO').length], ['En atención', open.filter(c => c.status !== 'NUEVO').length], [this.role === 'driver' ? 'Sin leer' : 'Respuesta recibida', this.role === 'driver' ? rows.filter(c => this.unread(c)).length : rows.filter(c => c.status === 'RESPUESTA_RECIBIDA').length], ['Finalizadas hoy', rows.filter(c => c.finalizedAt && D.limaDay(c.finalizedAt) === D.limaDay(now)).length], ['Mayor tiempo activo', D.elapsed(open.reduce((m,c) => Math.max(m,D.seconds(c.occurredAt,now)),0))] ];
      this.$('metrics').innerHTML = list.slice(0,this.role === 'driver' ? 3 : 5).map(([label,value]) => '<div class="metric"><small>' + label + '</small><strong>' + value + '</strong></div>').join('');
    }
    // Aviso de límites, solo para Central. Cada medición avisa en amarillo al 70% de su tope y en
    // rojo al 90%. El amarillo se puede cerrar por esta sesión; el rojo no, y vuelve a aparecer si
    // la medición sigue subiendo. Se apaga por completo desde Administración → Operación.
    limitsConfig() {
      // "Tiempo de consulta" se sacó de este aviso: es una medición del momento (puede subir por
      // una conexión lenta puntual o un reintento automático) y no un recurso que se va acumulando
      // como los otros tres, así que avisar por eso solo generaba ruido sin una acción real detrás.
      return [
        { key:'active', label:'Casos activos', value: this.limits && this.limits.activeCount, yellow:350, red:450, fmt:v=>v+' de 500' },
        { key:'cells', label:'Celdas del archivo de control', value: this.limits && this.limits.controlCells, yellow:7000000, red:9000000, fmt:v=>(v/1000000).toFixed(1)+' de 10 millones' },
        { key:'audit', label:'Filas de auditoría del mes', value: this.limits && this.limits.auditRows, yellow:35000, red:45000, fmt:v=>v+' de 50 000' },
      ];
    }
    renderLimits() {
      const el = this.$('limits-banner'); if (!el) return;
      this.dismissedLimits = this.dismissedLimits || new Set();
      const rows = this.limitsConfig().filter(m => m.value != null).map(m => Object.assign({}, m, { level: m.value >= m.red ? 'red' : m.value >= m.yellow ? 'yellow' : null }))
        .filter(m => m.level && !(m.level === 'yellow' && this.dismissedLimits.has(m.key)));
      if (!rows.length) { el.innerHTML = ''; return; }
      const worst = rows.some(r => r.level === 'red') ? 'red' : 'yellow';
      const style = worst === 'red' ? 'background:#a72e26;color:#fff' : 'background:#fff4d8;color:#755719';
      el.innerHTML = '<div style="' + style + ';padding:8px 18px;font-size:12px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
        rows.map(r => '<span>' + esc(r.label) + ': ' + esc(r.fmt(r.value)) + '</span>').join('') +
        (worst === 'yellow' ? '<button data-dismiss-limits style="margin-left:auto">Cerrar</button>' : '<strong style="margin-left:auto">Revise pronto</strong>') + '</div>';
      if (worst === 'yellow') { const btn = el.querySelector('[data-dismiss-limits]'); if (btn) btn.onclick = () => { rows.forEach(r => this.dismissedLimits.add(r.key)); this.renderLimits(); }; }
    }
    async select(item) {
      this.noteActivity();
      this.selected = item; if (this.role === 'driver') document.querySelector('.driver-shell').classList.add('case-open'); this.renderList(); this.renderContext(); this.renderWork();
      document.querySelectorAll('#ardepe-root [data-close-view]').forEach(button=>button.hidden=false);
      if (item.version) {
        const fresh = await this.service.detail(item.id); if (!this.selected || this.selected.id !== item.id) return;
        this.selected = fresh; this.renderContext(); this.renderWork(true);
        if (this.unread(fresh)) { await this.command('read', {}, fresh); }
      } else if (this.service.resolve) {
        this.resolving = item.id; this.renderWork();
        this.$('context').insertAdjacentHTML('afterbegin','<div class="info"><span class="spinner"></span>Consultando conductor, ubicación y valor…</div>');
        const release = () => { if (this.resolving === item.id) { this.resolving = null; if (this.selected && this.selected.id === item.id) this.renderWork(); } };
        const timer = setTimeout(release, 20000);
        try {
          const fresh = await this.service.resolve(item); clearTimeout(timer);
          if (this.resolving === item.id) this.resolving = null;
          if (!this.selected || this.selected.id !== item.id) return; this.selected = fresh; this.renderContext(); this.renderWork(true);
        } catch (error) { clearTimeout(timer); release(); throw error; }
      }
    }
    contextHTML(c, compact) {
      const coord = typeof c.latitude === 'number' && typeof c.longitude === 'number';
      const operational=c.origin==='GEOTAB'
        ? '<div><dt>'+esc(this.measurementLabel(c))+'</dt><dd>'+esc(this.measurementText(c))+'</dd></div>'
        : '<div><dt>Tipo de reporte</dt><dd>'+esc(c.type||c.title||'No informado')+'</dd></div>';
      const reportDetails=c.origin==='GEOTAB'
        ? '<p class="section-label">Detalle del evento</p><p>'+esc(c.description||c.title||'Sin detalle')+'</p>'
        : '<p class="section-label">Información proporcionada</p><dl class="report-facts"><div><dt>Descripción o motivo</dt><dd>'+esc(c.description||'No informado')+'</dd></div><div><dt>Daños</dt><dd>'+esc(c.damages||'No informado')+'</dd></div><div><dt>Personas afectadas</dt><dd>'+esc(c.affected||'No informado')+'</dd></div></dl>';
      return '<div class="content"><div class="detail-badges">' + badge(c.status, D.STATES[c.status]) + '<span class="origin-chip '+esc(c.origin)+'">'+esc(originLabel(c.origin))+'</span></div><h2 class="detail-title">' + esc(c.title) + '</h2><small>' + date(c.occurredAt) + '</small><dl class="facts"><div><dt>Vehículo</dt><dd>' + esc(c.plate || 'Por confirmar') + '</dd></div>'+operational+'<div class="wide"><dt>Conductor</dt><dd>' + esc(c.driverName || 'Por confirmar') + '</dd></div><div class="wide"><dt>Ubicación</dt><dd>' + esc(c.location || 'No disponible') + '</dd></div><div class="wide"><dt>Personal asignado</dt><dd>' + esc(c.operator ? c.operator.name + ' · ' + c.operator.area : 'Sin iniciar') + '</dd></div></dl>' +
        (!compact && coord ? '<div class="map"><iframe title="Ubicación del evento" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=' + encodeURIComponent([c.longitude-.012,c.latitude-.007,c.longitude+.012,c.latitude+.007].join(',')) + '&layer=mapnik&marker=' + encodeURIComponent(c.latitude+','+c.longitude) + '"></iframe></div><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=' + c.latitude + '&mlon=' + c.longitude + '#map=16/' + c.latitude + '/' + c.longitude + '">Ampliar mapa</a>' : '') +
        reportDetails + (c.result ? '<p class="section-label">Resultado</p><p>' + esc(c.result) + '</p>' : '') +
        ((c.events||[]).length ? '<p class="section-label">Eventos asociados ('+c.events.length+')</p>'+c.events.map(e=>{const r=(this.rules||[]).find(x=>x.id===e.ruleId);const label=r&&r.customLabel?r.customLabel+': ':'';const txt=r&&r.kind==='none'?(e.measurement?'Solo alerta':'Valor no disponible'):(e.measurement?e.measurement.text:'Valor no disponible');return '<p>'+esc(e.title)+' · '+date(e.occurredAt)+' · '+esc(label+txt)+'</p>';}).join('') : '') + '<div class="timing"><div><small>Tiempo total</small><strong data-time="total">—</strong></div><div><small>Hasta inicio atención</small><strong data-time="toStart">—</strong></div><div><small>Espera de conductor</small><strong data-time="waiting">—</strong></div><div><small>Seguimiento</small><strong data-time="followUp">—</strong></div></div></div>';
    }
    renderContext() { this.$('context').innerHTML = this.contextHTML(this.selected, false); this.tick(); }
    renderWork(preserve = false) {
      const c = this.selected; if (!c) return;
      const work=this.$('work'),dirty=preserve&&work.dataset.dirty==='1',managementOpen=preserve&&Boolean(work.querySelector('#a-manage-form')&&work.querySelector('#a-manage-form').closest('details').open);
      const saved = {};
      if (preserve) this.$('work').querySelectorAll('input:not([type=file]),textarea,select').forEach(el => { saved[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
      const fileInput = preserve ? this.$('work').querySelector('input[type=file]') : null;
      const mine = this.role === 'driver' || c.operator && c.operator.id === this.$('person').value;
      const closed = c.status === 'FINALIZADA';
      const sendAllowed=this.role==='driver' || !(c.eventKeys||[]).length || (c.events||[]).length>0 && c.events.every(e=>{const r=this.rules.find(r=>r.id===e.ruleId);return r && r.active && r.allowSend===true;});
      const workflow=this.role==='central'?'<nav class="workflow-strip" aria-label="Etapas de atención"><span>1. Validar</span><span>2. Comunicar</span><span>3. Evaluar</span><span>4. Actuar</span><span>5. Finalizar</span></nav>':'';
      this.$('manager').textContent = c.operator ? c.operator.name : '';
      this.$('work').innerHTML = (this.role === 'driver' ? '<div class="mobile-case-nav"><button id="a-mobile-back">‹ Volver a mis atenciones</button></div>' : '') + workflow + '<div class="detail-inline">' + this.contextHTML(c,true) + '</div><div class="content">' +
        (this.role === 'central' ? '<div class="context-actions">' + (!c.version || !c.operator ? '<button id="a-take" class="primary"' + (this.resolving === c.id && !c.version ? ' disabled' : '') + '>Iniciar atención</button>' : '') + (c.version && !closed ? '<button id="a-change-driver">Cambiar conductor</button>' : '') + (c.version && !closed && mine ? '<button id="a-associate">Asociar eventos</button>' : '') + (c.version ? '<button id="a-export">Exportar PDF</button>' : '') + '</div>' : '') +
        (!c.version ? '<div class="info">El evento todavía no se guarda en el Servidor. Inicie la atención para registrar el caso.</div>' : '') +
        '<p class="section-label">Conversación y evidencias</p><div id="a-messages">' + this.messagesHTML(c) + '</div>' +
        (c.version && !closed ? (this.role === 'driver' && this.needsOnlyConfirmation(c)
          ? '<form id="a-confirm-form" class="form-stack"><p class="muted">Monitoreo le envió información. No hace falta responder, solo confirme que la recibió.</p><button class="primary" type="submit">Confirmar recepción</button></form>'
          : '<form id="a-message-form" class="form-stack"><fieldset ' + (!mine || !sendAllowed ? 'disabled' : '') + ' class="form-stack"><label>' + (this.role === 'driver' ? 'Mi respuesta o información adicional' : 'Mensaje al conductor') + '<textarea name="text" required maxlength="6000" placeholder="Escriba información clara sobre este caso."></textarea></label><label>Adjuntar imagen, PDF o documento<input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.txt,.docx,.xlsx"><small>Hasta 3 archivos · 3 MB cada uno después de optimizar imágenes · sin video</small></label>' + (this.role === 'central' ? '<label class="check"><input type="checkbox" name="requiresResponse" checked>Solicitar respuesta del conductor</label><label class="check"><input type="checkbox" name="clarification">Es una solicitud de aclaración</label>' : '') + '<button class="primary" type="submit">Enviar mensaje</button></fieldset></form>'
        ) : closed ? '<div class="info">Atención finalizada. La conversación y las evidencias se conservan para consulta.</div>' : '') +
        (this.role === 'central' && c.version && !closed ? this.managementHTML(mine, c) : '') +
        (c.managements && c.managements.length ? '<p class="section-label">Gestiones registradas</p>' + c.managements.map(m => this.managementRecordHTML(m,c)).join('') : '') + '</div>';
      if (preserve) this.$('work').querySelectorAll('input:not([type=file]),textarea,select').forEach(el => { if (Object.hasOwn(saved,el.name)) { if (el.type === 'checkbox') el.checked = saved[el.name]; else el.value = saved[el.name]; } });
      if (fileInput && this.$('work').querySelector('input[type=file]')) this.$('work').querySelector('input[type=file]').replaceWith(fileInput);
      if(managementOpen&&this.$('manage-form'))this.$('manage-form').closest('details').open=true;work.dataset.dirty=dirty?'1':'';work.oninput=()=>{work.dataset.dirty='1';};
      if (this.$('take')) this.$('take').onclick = () => this.run(this.$('take'), stage => this.take(stage));
      if (this.$('mobile-back')) this.$('mobile-back').onclick = () => this.closeMobileCase();
      if (this.$('change-driver')) this.$('change-driver').onclick = () => this.driverDialog();
      if (this.$('export')) this.$('export').onclick = () => this.run(this.$('export'), stage => this.exportCases([c], stage));
      if (this.$('message-form')) this.$('message-form').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; this.run(event.submitter, async stage => {stage('Preparando…');const data = new FormData(form), attachments = await this.prepareFiles(form.elements.files.files);await this.command('message',{ text:data.get('text'), requiresResponse:data.has('requiresResponse'), clarification:data.has('clarification'), attachments },this.selected,stage);if(this.role==='central')this.closeCentralCase();else this.renderWork();this.toast('Mensaje enviado al Servidor');}); };
      if (this.$('confirm-form')) this.$('confirm-form').onsubmit = event => { event.preventDefault(); this.run(event.submitter, async stage => {stage('Enviando…');await this.command('message',{ text:'Mensaje recibido', requiresResponse:false, confirmationOnly:true },this.selected,stage);this.renderWork();this.toast('Recepción confirmada');}); };
      // Formulario completo: si el resultado elegido es "Falsa alerta" o "Solo informativo", se
      // ocultan Canal, Causa, Tipo de acción, Acción realizada y Resumen (no son obligatorios ahí).
      if (this.$('manage-result')) {
        const toggleInformative = () => {
          const informative = ['Falsa alerta', 'Solo informativo'].includes(this.$('manage-result').value);
          this.$('manage-channel-field').hidden = informative;
          this.$('manage-detail-fields').hidden = informative;
          this.$('manage-summary-field').hidden = informative;
        };
        this.$('manage-result').onchange = toggleInformative; toggleInformative();
      }
      if (this.$('manage-form')) this.$('manage-form').onsubmit = event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); this.run(event.submitter, async stage => {stage('Guardando…');await this.command('manage',payload,this.selected,stage);this.renderWork();this.toast(payload.status==='FINALIZADA'?'Gestión finalizada':'Gestión registrada');}); };
      // Actualizar seguimiento: hereda resultado, causa, canal, acción y responsable de la última
      // gestión ya registrada; solo pide la novedad de esta vez y, si corresponde, el estado y la fecha.
      if (this.$('followup-form')) this.$('followup-form').onsubmit = event => { event.preventDefault(); const fd = new FormData(event.currentTarget), note = String(fd.get('note')||'').trim(), last = c.managements[c.managements.length-1]; const payload = { result:last.result, cause:last.cause, channel:last.channel, action:last.action, owner:last.owner, immediateAction:note, summary:note, status:fd.get('status'), dueDate:fd.get('dueDate') }; this.run(event.submitter, async stage => {stage('Guardando…');await this.command('manage',payload,this.selected,stage);this.renderWork();this.toast(payload.status==='FINALIZADA'?'Gestión finalizada':'Seguimiento registrado');}); };
      if (this.$('manage-mode-short') && this.$('manage-mode-full')) {
        this.$('manage-mode-short').onclick = () => { this.$('manage-short-wrap').hidden=false; this.$('manage-full-wrap').hidden=true; this.$('manage-mode-short').classList.add('active'); this.$('manage-mode-full').classList.remove('active'); };
        this.$('manage-mode-full').onclick = () => { this.$('manage-short-wrap').hidden=true; this.$('manage-full-wrap').hidden=false; this.$('manage-mode-full').classList.add('active'); this.$('manage-mode-short').classList.remove('active'); };
      }
      this.$('work').querySelectorAll('[data-evidence]').forEach(button => button.onclick = () => this.run(button, () => this.showEvidence(c.attachments.find(a => a.id === button.dataset.evidence),button)));
      if(this.$('associate'))this.$('associate').onclick=()=>this.associateDialog();
      if(this.$('manage-status')){const toggle=()=>{const follow=D.FOLLOW_STATES.includes(this.$('manage-status').value);this.$('follow-date').hidden=!follow;this.$('manage-form').elements.owner.required=follow;this.$('manage-form').elements.dueDate.required=follow;};this.$('manage-status').onchange=toggle;toggle();}
      if(this.$('followup-status')){const toggle=()=>{const follow=D.FOLLOW_STATES.includes(this.$('followup-status').value);this.$('followup-date').hidden=!follow;this.$('followup-form').elements.dueDate.required=follow;};this.$('followup-status').onchange=toggle;toggle();}
      if(!sendAllowed && c.version && !closed)this.$('messages').insertAdjacentHTML('afterend','<p class="info">La regla no permite enviar mensajes al conductor. Puede registrar la gestión interna.</p>');
      this.tick();
    }
    closeMobileCase() { this.clearSelection(); }
    closeCentralCase() {
      this.clearSelection(true);
    }
    messagesHTML(c) {
      if (!c.messages || !c.messages.length) return '<p class="muted" style="margin:12px 0">Todavía no hay mensajes en este caso.</p>';
      return c.messages.map(m => {const read=m.role==='central'?c.readByDriverAt>=m.at:c.readByCentralAt>=m.at,status=read?(m.role==='central'?'Leído por el conductor':'Leído por Monitoreo'):'Enviado';return '<article class="message ' + m.role + '"><header><strong>' + esc(m.author) + '</strong><small>' + (m.role === 'central' ? 'Monitoreo' : 'Conductor') + '</small></header><p>' + esc(m.text) + '</p><small>' + date(m.at) + ' · '+status+(m.requiresResponse ? ' · Solicita respuesta' : '')+(m.confirmationOnly ? ' · Solo confirmación' : '') + '</small>' + (c.attachments || []).filter(a => a.messageId === m.id).map(a => '<button class="attachment-name" data-evidence="' + esc(a.id) + '"><b>'+esc(a.name)+'</b><small>'+esc(a.mimeType||'Archivo')+' · '+bytes(a.size)+'</small></button>').join('') + '</article>';}).join('');
    }
    managementRecordHTML(m,c){
      const fields=[['Resultado',m.result],['Causa',m.cause],['Canal de atención',channelLabel(m.channel)],['Tipo de acción',m.action],['Acción realizada',m.immediateAction],['Detalle adicional de acción',m.correctiveAction],['Responsable de seguimiento',m.owner],['Fecha límite de seguimiento',m.dueDate],['Resumen y observaciones',m.summary],['Observación complementaria',m.notes],['Estado registrado',D.STATES[m.status]||m.status]];
      return '<article class="management-record"><header><strong>'+esc(m.person&&m.person.name||'Personal de Monitoreo')+'</strong><small>Fecha y hora de gestión: '+date(m.at)+'</small></header><dl>'+fields.filter(([,value])=>value).map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+(m.status==='FINALIZADA'?'<div><dt>Fecha y hora de cierre</dt><dd>'+date(c.finalizedAt||m.at)+'</dd></div>':'')+'</dl></article>';
    }
    // El formulario de gestión tiene dos caminos, según si el caso ya tiene una gestión anterior:
    // - Sin gestión previa: solo el formulario completo, con el responsable de seguimiento prellenado
    //   con la persona activa en ese momento ("¿Eres tú?").
    // - Con gestión previa: por defecto "Actualizar seguimiento" (corto: qué se hizo y el estado),
    //   heredando resultado/causa/canal/acción/responsable de la última gestión; "Gestión completa"
    //   sigue disponible como pestaña aparte para cuando de verdad cambia algo de fondo, y en ese
    //   caso el responsable se prellena con el de la última gestión, no con la persona activa.
    // Además, si el resultado elegido es "Falsa alerta" o "Solo informativo", el formulario completo
    // se simplifica: solo pide Resultado y Estado al guardar (validado también en domain.js).
    managementHTML(enabled, c) {
      const lastMgmt = (c.managements && c.managements.length) ? c.managements[c.managements.length - 1] : null;
      const activePeople = (this.people || []).filter(p => p.active);
      const currentPerson = activePeople.find(p => p.id === this.$('person').value);
      const ownerList = '<datalist id="a-owner-list">' + activePeople.map(p => '<option value="' + esc(p.name) + '">').join('') + '</datalist>';
      const fullOwnerDefault = lastMgmt ? (lastMgmt.owner || '') : (currentPerson ? currentPerson.name : '');
      const fullOwnerHint = (!lastMgmt && currentPerson) ? '<small>¿Eres tú? Puede escribir otro nombre.</small>' : '';
      const fullForm = '<form id="a-manage-form" class="form-stack"><fieldset class="form-stack" ' + (!enabled ? 'disabled' : '') + '>' +
        '<div class="two"><label>Resultado<select id="a-manage-result" name="result" required><option value="">Seleccionar</option>' + options(D.RESULTS.filter(r => r !== 'Sin elementos para continuar')) + '</select></label>' +
        '<label id="a-manage-channel-field">Canal de atención<select name="channel">' + options(D.CHANNELS.filter(channel => channel !== 'Drive')) + '</select></label></div>' +
        '<div id="a-manage-detail-fields"><label>Causa identificada<select name="cause">' + options(D.CAUSES,'No determinada') + '</select></label>' +
        '<label>Tipo de acción<select name="action">' + options(D.ACTIONS) + '</select></label>' +
        '<label>Acción realizada<textarea name="immediateAction" placeholder="Indique en un solo campo qué se hizo."></textarea></label></div>' +
        '<label>Estado al guardar<select id="a-manage-status" name="status"><option value="EN_GESTION">Continuar en gestión</option>' + D.FOLLOW_STATES.map(s => '<option value="' + s + '">' + D.STATES[s] + '</option>').join('') + '<option value="FINALIZADA">Atención finalizada</option></select></label>' +
        '<label>Responsable de seguimiento<input name="owner" list="a-owner-list" value="' + esc(fullOwnerDefault) + '" placeholder="Escriba para buscar">' + fullOwnerHint + '</label>' + ownerList +
        '<label id="a-follow-date" hidden>Fecha límite de seguimiento<input name="dueDate" type="date"></label>' +
        '<div id="a-manage-summary-field"><label>Resumen y observaciones<textarea name="summary" placeholder="Resuma la atención y agregue aquí cualquier observación necesaria."></textarea></label></div>' +
        '<button type="submit" class="primary">Registrar gestión</button></fieldset></form>';
      if (!lastMgmt) return '<details class="section-box" open><summary>Evaluación, acciones y finalización</summary>' + fullForm + '</details>';
      const shortForm = '<form id="a-followup-form" class="form-stack"><fieldset class="form-stack" ' + (!enabled ? 'disabled' : '') + '>' +
        '<label>¿Qué hizo esta vez?<textarea name="note" required placeholder="Describa brevemente la novedad de este seguimiento."></textarea></label>' +
        '<label>Estado al guardar<select id="a-followup-status" name="status"><option value="EN_GESTION">Continuar en gestión</option>' + D.FOLLOW_STATES.map(s => '<option value="' + s + '"' + (s === c.status ? ' selected' : '') + '>' + D.STATES[s] + '</option>').join('') + '<option value="FINALIZADA">Atención finalizada</option></select></label>' +
        '<label id="a-followup-date" hidden>Fecha límite de seguimiento<input name="dueDate" type="date" value="' + esc(lastMgmt.dueDate || '') + '"></label>' +
        '<button type="submit" class="primary">Registrar seguimiento</button></fieldset></form>';
      return '<details class="section-box" open><summary>Evaluación, acciones y finalización</summary>' +
        '<div class="tabs" style="margin-bottom:10px"><button type="button" id="a-manage-mode-short" class="active">Actualizar seguimiento</button><button type="button" id="a-manage-mode-full">Gestión completa</button></div>' +
        '<div id="a-manage-short-wrap">' + shortForm + '</div><div id="a-manage-full-wrap" hidden>' + fullForm + '</div></details>';
    }
    tick() { if (!this.selected || !this.mounted) return; const c = this.selected, times = c.version ? D.times(c,new Date().toISOString()) : { total:D.seconds(c.occurredAt,new Date().toISOString()),toStart:D.seconds(c.occurredAt,new Date().toISOString()),waiting:0,followUp:0 }; document.querySelectorAll('[data-time]').forEach(el => el.textContent = D.elapsed(times[el.dataset.time])); }
    async command(type, payload, current = this.selected, onProgress) {
      const id = type === 'create' ? payload.caseId || D.month(new Date()) + '_' + S.uid() : current.id;
      const signature = JSON.stringify({type,payload,id,person:this.$('person').value});
      let command = this.pending.get(signature);
      if (!command) { command = { type, payload, caseId:id, version:current && current.version || 0, operationId:S.uid(),receipt:S.uid() }; this.pending.set(signature,command); }
      // Se pausa el refresco de fondo mientras dura el envío, para que no compita por la misma
      // conexión justo cuando más importa que el envío llegue rápido. Se retoma apenas termina.
      this.pause();
      try {
        const result = await this.service.command(command,this.$('person').value,onProgress);
        this.noteActivity();
        this.pending.delete(signature); this.cases = this.cases.filter(c => c.id !== result.id).concat(result); this.selected = result;
        if (this.role === 'driver') document.querySelector('.driver-shell').classList.add('case-open');
        if (this.mode !== 'live') this.historyRows = (this.historyRows || []).map(c => c.id === result.id ? result : c);
        this.renderContext(); this.renderWork(true); this.renderList(); this.metrics(); return result;
      } catch (error) { if (!error.uncertain) this.pending.delete(signature); throw error; }
      finally { this.resume(); }
    }
    async take(onProgress) { if(this.role==='central'&&!this.$('person').value)return this.toast('Seleccione personal activo antes de continuar',true); const c = this.selected;if(onProgress)onProgress('Guardando…');if (!c.version) await this.command('create',{...c,caseId:c.caseId || (c.caseId=D.month(new Date())+'_'+S.uid())},c,onProgress); else await this.command('take',{},c,onProgress); this.renderWork(); this.toast('Atención iniciada'); }
    dialog(title, html) { this.$('dialog-title').textContent = title; this.$('dialog-body').innerHTML = html; if (!this.$('dialog').open) this.$('dialog').showModal(); }
    associateDialog() {
      const target=this.selected;
      this.dialog('Asociar eventos al caso','<form id="a-associate-search" class="form-stack"><p>Busque eventos de hasta siete días y seleccione los que pertenecen a esta atención. Cada evento conserva su fecha y valor.</p><label>Regla<select name="rule" required><option value="">Seleccionar</option>'+(this.rules||[]).filter(r=>r.active).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>').join('')+'</select></label><div class="two"><label>Desde · Lima<input type="datetime-local" name="from" required></label><label>Hasta · Lima<input type="datetime-local" name="to" required></label></div><button>Buscar eventos</button></form><div id="a-associate-results" class="list-choice"></div>');
      const form=this.$('associate-search'),range=D.preset('today');
      for(const key of ['from','to'])form.elements[key].value=new Date(Date.parse(range[key])-18000000).toISOString().slice(0,16);
      form.onsubmit=event=>{event.preventDefault();this.run(event.submitter,async()=>{
        const rows=await this.service.explore(new Date(form.elements.from.value+'-05:00').toISOString(),new Date(form.elements.to.value+'-05:00').toISOString(),form.elements.rule.value);
        const container=this.$('associate-results');container.innerHTML=rows.length?rows.map((row,i)=>'<label class="check"><input type="checkbox" data-event="'+i+'">'+esc(row.plate)+' · '+esc(row.title)+' · '+date(row.occurredAt)+'</label>').join('')+'<button id="a-associate-save" class="primary">Asociar seleccionados</button>':'<p>No hay eventos disponibles en este rango.</p>';
        if(this.$('associate-save'))this.$('associate-save').onclick=()=>this.run(this.$('associate-save'),async()=>{
          const selected=[...container.querySelectorAll('[data-event]:checked')];if(!selected.length)throw new Error('Seleccione al menos un evento');
          if(this.selected.id!==target.id)throw new Error('Vuelva a seleccionar el caso');
          for(const input of selected){const row=rows[Number(input.dataset.event)],resolved=this.service.resolve?await this.service.resolve(row):row;await this.command('associate',{eventKey:resolved.eventKey,occurredAt:resolved.occurredAt,title:resolved.title,measurement:resolved.measurement,ruleId:resolved.ruleId||resolved.rule&&resolved.rule.id});input.checked=false;input.disabled=true;}
          this.$('dialog').close();this.toast('Eventos asociados');
        });
      });};
    }
    async driverDialog() {
      this.dialog('Cambiar conductor','<div class="empty"><span class="spinner"></span>Buscando conductores…</div>');
      try { const drivers = await this.service.drivers(); this.dialog('Cambiar conductor','<input id="a-driver-search" type="search" placeholder="Buscar por nombre" aria-label="Buscar conductor"><div id="a-driver-list" class="list-choice"></div>'); const render = () => { this.$('driver-list').innerHTML = ''; drivers.filter(d => d.name.toLowerCase().includes(this.$('driver-search').value.toLowerCase())).slice(0,60).forEach(d => { const button = document.createElement('button'); button.textContent = d.name; button.onclick = () => this.run(button,async () => { await this.command('assign',{driverId:d.id,driverName:d.name});this.$('dialog').close(); }); this.$('driver-list').append(button); }); }; this.$('driver-search').oninput=render;render(); } catch(error) { this.toast(error.message,true); }
    }
    async createDialog() {
      if (!this.service) return this.toast('Abra la demostración o conecte Geotab',true);
      if (this.role==='central' && !this.$('person').value) return this.toast('Seleccione personal activo antes de continuar',true);
      this.dialog(this.role === 'driver' ? 'Reportar incidente' : 'Crear caso','<div class="empty"><span class="spinner"></span>Preparando formulario…</div>');
      try {
        const driverResponse = this.role === 'central' ? await this.service.drivers() : [], deviceResponse = await this.service.devices(), mobile=this.role==='driver'&&this.service.mobileContext?await this.service.mobileContext():{};
        const drivers=Array.isArray(driverResponse)?driverResponse:[],devices=Array.isArray(deviceResponse)?deviceResponse:[];
        const local = new Date(Date.now()-18000000).toISOString().slice(0,16);
        this.dialog(this.role === 'driver' ? 'Reportar incidente' : 'Crear caso','<form id="a-create-form" class="form-stack"><div class="two"><label>Tipo<select name="type">' + options(D.TYPES) + '</select></label><label>Prioridad<select name="priority">' + options(D.PRIORITIES,'MEDIA') + '</select></label></div>' + (this.role === 'central' ? '<label>Conductor<input name="driverSearch" list="a-create-driver-list" required placeholder="Escriba para buscar"><datalist id="a-create-driver-list">' + drivers.map(d => '<option value="'+esc(d.name)+'">').join('') + '</datalist></label>' : '<div class="info">Conductor: '+esc(this.service.actor.name)+(mobile.plate?' · Vehículo: '+esc(mobile.plate):' · Vehículo no detectado')+(mobile.location?' · Ubicación detectada':' · Ubicación no disponible')+'</div>') + '<div class="two"><label>Vehículo<select name="deviceId"><option value="">No disponible</option>' + devices.map(d => '<option value="'+esc(d.id)+'" '+(d.id===mobile.deviceId?'selected':'')+'>'+esc(d.name)+'</option>').join('') + '</select></label><label>Fecha y hora · Lima<input name="occurredAt" type="datetime-local" value="'+local+'" required></label></div><label>Ubicación<input name="location" maxlength="500" value="'+esc(mobile.location||'')+'"></label><input type="hidden" name="latitude" value="'+esc(mobile.latitude??'')+'"><input type="hidden" name="longitude" value="'+esc(mobile.longitude??'')+'"><label>Descripción / motivo<textarea name="description" required maxlength="6000"></textarea></label><div class="two"><label>Daños<input name="damages" maxlength="500"></label><label>Personas afectadas<input name="affected" maxlength="500"></label></div><label>'+(this.role==='central'?'Mensaje inicial al conductor':'Comentario adicional')+'<textarea name="initialMessage" '+(this.role==='central'?'required':'')+' maxlength="6000"></textarea></label><label>Adjuntar evidencia<input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.txt,.docx,.xlsx"><small>Hasta 3 archivos · sin video</small></label>'+(this.role==='central'?'<label class="check"><input name="requiresResponse" type="checkbox" checked>Requiere respuesta del conductor</label>':'')+'<button class="primary">Crear caso y registrar información</button></form>');
        this.$('create-form').onsubmit = event => { event.preventDefault(); const fd=new FormData(event.currentTarget),payload=Object.fromEntries(fd);delete payload.files;
          if (this.role === 'central') {
            const driverMap = new Map(drivers.map(d => [d.name, d.id]));
            const typed = String(payload.driverSearch || '').trim(); delete payload.driverSearch;
            const driverId = driverMap.get(typed);
            if (!driverId) return this.toast('Escriba el nombre exacto de un conductor registrado y elíjalo de la lista', true);
            payload.driverId = driverId; payload.driverName = typed;
          }
          payload.initialMessage=String(payload.initialMessage||'').trim();payload.requiresResponse=fd.has('requiresResponse');payload.occurredAt = new Date(payload.occurredAt+'-05:00').toISOString(); payload.title = payload.type; payload.plate = (devices.find(d=>d.id===payload.deviceId)||{}).name||''; payload.caseId = this.createCaseId || (this.createCaseId=D.month(new Date())+'_'+S.uid()); this.run(event.submitter,async stage=>{stage('Preparando…');payload.attachments=await this.prepareFiles([...event.currentTarget.elements.files.files]);stage('Guardando…');await this.command('create',payload,null,stage);this.createCaseId=null;this.$('dialog').close();if(this.role==='central')this.closeCentralCase();else this.renderWork();this.toast('Caso e información inicial enviados al Servidor'); }); };
      } catch(error) { this.toast(error.message,true); }
    }
    historyDialog() {
      if (this.summaryMode) {
        this.dialog('Consulta histórica','<form id="a-history-form" class="form-stack"><div class="presets"><button type="button" data-preset="today">Hoy</button><button type="button" data-preset="yesterday">Ayer</button><button type="button" data-preset="7days">Últimos 7 días</button></div><div class="two"><label>Desde · Lima<input name="from" type="datetime-local" step="1" required></label><label>Hasta · Lima<input name="to" type="datetime-local" step="1" required></label></div><button class="primary">Consultar</button></form>');
        const form=this.$('history-form');
        const setPreset=key=>{ const range=D.preset(key); for(const [name,value] of Object.entries(range)) form.elements[name].value=new Date(Date.parse(value)-18000000).toISOString().slice(0,19); form.querySelectorAll('[data-preset]').forEach(b=>{b.classList.toggle('active',b.dataset.preset===key);b.setAttribute('aria-pressed',String(b.dataset.preset===key));}); };
        form.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>setPreset(b.dataset.preset));setPreset('yesterday');
        form.onsubmit=event=>{event.preventDefault();const value=Object.fromEntries(new FormData(form));this.run(event.submitter,async()=>{const from=new Date(value.from+'-05:00').toISOString(),to=new Date(value.to+'-05:00').toISOString();this.$('dialog').close();await this.loadSummaryData(from,to,date(from)+' — '+date(to));});};
        return;
      }
      const isCentral = this.role === 'central';
      this.dialog('Consulta histórica','<form id="a-history-form" class="form-stack"><label>Consultar<select name="source"><option value="cases">Historial de atenciones</option>' + (isCentral?'<option value="events">Eventos Geotab por gestionar</option>':'') + '</select></label><div class="presets"><button type="button" data-preset="today">Hoy</button><button type="button" data-preset="yesterday">Ayer</button><button type="button" data-preset="7days">Últimos 7 días</button></div><div class="two"><label>Desde · Lima<input name="from" type="datetime-local" step="1" required></label><label>Hasta · Lima<input name="to" type="datetime-local" step="1" required></label></div>' + (isCentral ? '<label>Regla (obligatoria para eventos Geotab)<select name="rule"><option value="">Seleccionar regla</option>' + (this.rules||[]).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>').join('') + '</select></label>' : '') + '<p class="muted">' + (isCentral ? 'Geotab: máximo 7 días. Atenciones: hasta un año por consulta. Los pendientes antiguos siguen en la vista activa.' : 'Puede consultar hasta un año por vez. Los pendientes antiguos siguen en la vista activa.') + '</p><button class="primary">Consultar</button></form>');
      const form=this.$('history-form');
      const setPreset=key=>{ const range=D.preset(key); for(const [name,value] of Object.entries(range)) form.elements[name].value=new Date(Date.parse(value)-18000000).toISOString().slice(0,19); form.querySelectorAll('[data-preset]').forEach(b=>{b.classList.toggle('active',b.dataset.preset===key);b.setAttribute('aria-pressed',String(b.dataset.preset===key));}); };
      form.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>setPreset(b.dataset.preset));setPreset('yesterday');
      ['from','to'].forEach(name=>form.elements[name].oninput=()=>form.querySelectorAll('[data-preset]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');}));
      form.onsubmit=event=>{event.preventDefault();if(!this.clearSelection())return;const value=Object.fromEntries(new FormData(form));this.run(event.submitter,async()=>{const from=new Date(value.from+'-05:00').toISOString(),to=new Date(value.to+'-05:00').toISOString();if(value.source==='events'){this.historyRows=await this.service.explore(from,to,value.rule);this.historyNextToken='';this.origin='GEOTAB';}else{const result=await this.service.history(from,to);this.historyRows=result.cases;this.historyNextToken=result.nextPageToken||'';this.historyQuery={from,to};if(this.role==='driver')this.origin='ALL';} this.mode=value.source;this.$('tabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.origin===this.origin));this.$('state').value='ALL';this.$('priority').value='ALL';this.$('search').value='';this.$('history-label').textContent=(value.source==='events'?'Eventos Geotab por gestionar':'Historial de atenciones')+' · '+date(from)+' — '+date(to);this.$('history-banner').hidden=false;this.$('dialog').close();this.page=0;this.renderList();this.metrics();});};
    }
    guide() {
      const extra=this.service.settings&&(this.role==='driver'?this.service.settings.driverGuide:this.service.settings.centralGuide);
      const topics=this.role==='driver'?
        [
          ['solicitud','Responder una solicitud','<ol><li>Abra <b>Sin leer</b> y seleccione la atención.</li><li>Revise vehículo, fecha, lugar y valor detectado.</li><li>Escriba su versión y adjunte evidencia si corresponde.</li><li>Pulse <b>Enviar mensaje</b>.</li></ol>'],
          ['reporte','Crear un reporte','<ol><li>Pulse <b>Reportar</b>.</li><li>Seleccione tipo y prioridad.</li><li>Confirme vehículo, fecha y ubicación.</li><li>Describa el hecho, daños y personas afectadas.</li><li>Adjunte evidencia y envíe.</li></ol>'],
          ['evidencia','Adjuntar evidencia','<p>Puede adjuntar imágenes, PDF y documentos. Se permiten hasta tres archivos por envío y no se aceptan videos. Si necesita corregir información, envíe un mensaje nuevo.</p>'],
          ['estados','Casos e historial','<p><b>Pendientes</b> reúne los casos abiertos. <b>Sin leer</b> muestra solicitudes que todavía no abrió. <b>Finalizados</b> contiene atenciones terminadas desde esta implementación. <b>Historial</b> permite consultar por fechas.</p>']
        ]:
        [
          ['inicio','Configuración inicial','<ol><li>Abra Administración.</li><li>Registre personal activo con permiso para gestionar.</li><li>Registre las reglas Geotab y su forma de medición.</li><li>Seleccione al operador en la barra superior.</li></ol>'],
          ['evento','Atender un evento','<ol><li>Revise Alertas Geotab.</li><li>Seleccione un evento y valide conductor, vehículo, ubicación y valor.</li><li>Pulse <b>Iniciar atención</b>. Solo entonces se registra en el Servidor.</li></ol>'],
          ['comunicar','Contactar al conductor','<ol><li>Elija Geotab Drive, teléfono, supervisor u otro canal.</li><li>Si usa Geotab Drive, escriba una solicitud clara y marque si requiere respuesta.</li><li>Las respuestas y evidencias aparecerán dentro del mismo caso.</li></ol>'],
          ['finalizar','Evaluar y finalizar','<ol><li>Registre resultado, causa, canal y acción.</li><li>Defina responsable y fecha si existe seguimiento.</li><li>Finalice solo cuando el expediente esté completo.</li></ol>'],
          ['consulta','Histórico y PDF','<p>El Histórico contiene únicamente casos de esta implementación. Los eventos por gestionar se consultan en Geotab sin almacenarlos. El PDF se genera con la información actual y no se guarda automáticamente en Google Drive.</p>']
        ];
      this.dialog('Centro de ayuda','<div class="guide-browser"><nav id="a-guide-topics" class="guide-topics">'+topics.map((t,i)=>'<button data-guide="'+t[0]+'" class="'+(i===0?'active':'')+'">'+t[1]+'</button>').join('')+'</nav><article id="a-guide-content" class="guide-content"></article><div class="info"><b>Valores:</b> paradas en horas, minutos y segundos; velocidad en km/h; maniobras en fuerza G.</div>'+(extra?'<p class="guide-extra">'+esc(extra)+'</p>':'')+'</div>');
      const show=id=>{const topic=topics.find(t=>t[0]===id)||topics[0];this.$('guide-content').innerHTML='<h3>'+topic[1]+'</h3>'+topic[2];this.$('guide-topics').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.guide===topic[0]));};
      this.$('guide-topics').onclick=event=>{const button=event.target.closest('[data-guide]');if(button)show(button.dataset.guide);};show(topics[0][0]);
    }
    async prepareFiles(files) {
      if (files.length>3) throw new Error('Máximo tres adjuntos por mensaje');
      const maxBytes=Math.min(3000000,Math.max(100000,Number(this.service.settings&&this.service.settings.maxAttachmentBytes)||3000000));
      const result=[];
      for(const file of files) {
        let dataUrl,mimeType=file.type,name=file.name;
        const read=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('No se pudo leer '+name));reader.readAsDataURL(blob);});
        if(['image/jpeg','image/png','image/webp'].includes(mimeType)) {
          if(file.size>12000000)throw new Error('La imagen original supera 12 MB');
          const bitmap=await createImageBitmap(file); const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();dataUrl=canvas.toDataURL('image/jpeg',.76);mimeType='image/jpeg';name=name.replace(/\.[^.]+$/,'')+'.jpg';
        } else { if(!mimeType){const ext=name.split('.').pop().toLowerCase();mimeType=Object.keys(D.FILE_TYPES).find(k=>D.FILE_TYPES[k].includes(ext))||'';} D.validateAttachment({name,mimeType,size:file.size},maxBytes);dataUrl=await read(file); }
        const size=atob(dataUrl.split(',')[1]).length;D.validateAttachment({name,mimeType,size},maxBytes);result.push({id:S.uid(),name,mimeType,size,dataUrl});
      }
      return result;
    }
    async showEvidence(file,button) {
      const dataUrl=await this.service.evidence(file);
      const blob=await (await fetch(dataUrl)).blob();this.clearEvidenceUrl();this.evidenceUrl=URL.createObjectURL(blob);
      const meta='<p class="evidence-meta"><b>'+esc(file.name)+'</b><span>'+esc(file.mimeType||'Archivo')+' · '+bytes(file.size)+'</span></p>';
      const actions='<div class="evidence-actions"><a class="action-link" href="'+this.evidenceUrl+'" target="_blank" rel="noopener">Abrir</a><a class="action-link primary-link" href="'+this.evidenceUrl+'" download="'+esc(file.name)+'">Descargar</a></div>';
      const preview=file.mimeType&&file.mimeType.startsWith('image/')?'<img class="evidence-preview" src="'+this.evidenceUrl+'" alt="'+esc(file.name)+'">':file.mimeType==='application/pdf'?'<iframe class="evidence-pdf" src="'+this.evidenceUrl+'" title="'+esc(file.name)+'"></iframe>':'<div class="empty"><strong>Documento listo</strong>Use Abrir o Descargar para consultarlo.</div>';
      this.dialog('Evidencia adjunta',meta+preview+actions);
    }
    clearEvidenceUrl(){if(this.evidenceUrl){URL.revokeObjectURL(this.evidenceUrl);this.evidenceUrl='';}}
    async exportCases(cases, onProgress) {
      if(!cases.length)throw new Error('No hay atenciones guardadas para exportar');
      if(cases.length>100)throw new Error('Filtre la consulta a un máximo de 100 casos por exportación');
      if(onProgress)onProgress('Ejecutando…');
      const rows=[];
      for(const item of cases){
        let lastError, ok=false;
        const exportStart=Date.now();
        // Hasta 3 intentos en silencio: solo ante una conexión lenta o caída (no ante un rechazo real
        // del servidor, que ya llega marcado como definitivo y se muestra de inmediato).
        for(let attempt=0;attempt<3&&!ok;attempt++){
          try{ rows.push(await this.service.detail(item.id)); ok=true; }
          catch(error){ lastError=error; if(error.definitive)break; if(attempt<2)await new Promise(r=>setTimeout(r,1000)); }
        }
        if(this.role==='central'){this.queryMs=Math.max(this.queryMs||0,Date.now()-exportStart);this.renderLimits();}
        if(!ok)throw lastError;
      }
      const bytes=await window.ArdepePDF.generate(rows,file=>this.service.evidence(file),undefined,undefined,this.rules||[]);
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),link=document.createElement('a');
      link.href=url;link.download='ARDEPE_atenciones_'+D.limaDay(new Date())+'.pdf';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      this.toast('PDF generado con '+rows.length+' atención(es)');
    }

    adminDialog() {
      this.dialog('Administración','<form id="a-admin-login" class="form-stack"><p class="muted">'+(this.demo?'Modo demostración: no valida un PIN real.':'El PIN se valida en Apps Script.')+'</p><label>PIN administrativo<input type="password" name="pin" autocomplete="off" '+(this.demo?'':'required')+'></label><button class="primary">Ingresar</button></form>');
      this.$('admin-login').onsubmit=event=>{event.preventDefault();const pin=event.currentTarget.elements.pin.value;this.run(event.submitter,async()=>{await this.service.adminLogin(pin);await this.adminContent();});};
    }
    async adminContent() {
      const data=await this.service.adminData();
      this.dialog('Administración','<div class="tabs"><button data-admin="personnel" class="active">Personal</button><button data-admin="rules">Reglas</button><button data-admin="settings">Operación</button><button data-admin="catalogs">Catálogos</button></div><div id="a-admin-editor"></div>');
      const render=type=>{
        if(type==='catalogs'){
          this.$('admin-editor').innerHTML='<div class="content"><p class="info">Estos catálogos forman parte del contrato auditado. Se actualizan con una versión del sistema para que el histórico siempre pueda reconstruirse.</p><p class="section-label">Tipos de reporte</p><p>'+D.TYPES.map(esc).join(' · ')+'</p><p class="section-label">Resultados</p><p>'+D.RESULTS.map(esc).join(' · ')+'</p><p class="section-label">Causas</p><p>'+D.CAUSES.map(esc).join(' · ')+'</p><p class="section-label">Acciones</p><p>'+D.ACTIONS.map(esc).join(' · ')+'</p><p class="section-label">Canales</p><p>'+D.CHANNELS.map(esc).join(' · ')+'</p></div>';return;
        }
        if(type==='settings'){
          const value=data.settings||{};
          const times=value.priorityMinutes||{CRITICA:15,ALTA:30,MEDIA:60,BAJA:120};
          this.$('admin-editor').innerHTML='<form id="a-settings-form" class="form-stack"><div class="two"><label>Grupos de vehículos (coma)<input name="vehicleGroups" required value="'+esc((value.vehicleGroups||[]).join(', '))+'"></label><label>Grupos de conductores (coma)<input name="driverGroups" required value="'+esc((value.driverGroups||[]).join(', '))+'"></label></div><div class="two"><label>Actualización automática (ms)<input name="pollMs" type="number" min="5000" max="120000" value="'+esc(value.pollMs||15000)+'"></label><label>Límite por adjunto (bytes)<input name="maxAttachmentBytes" type="number" min="100000" max="3000000" value="'+esc(value.maxAttachmentBytes||3000000)+'"></label></div><p class="section-label">Alertas orientativas por prioridad (minutos)</p><div class="two"><label>Crítica<input name="criticalMinutes" type="number" min="1" max="10080" value="'+esc(times.CRITICA)+'"></label><label>Alta<input name="highMinutes" type="number" min="1" max="10080" value="'+esc(times.ALTA)+'"></label><label>Media<input name="mediumMinutes" type="number" min="1" max="10080" value="'+esc(times.MEDIA)+'"></label><label>Baja<input name="lowMinutes" type="number" min="1" max="10080" value="'+esc(times.BAJA)+'"></label></div><div class="two"><label>Casos por página histórica<input name="historyPageSize" type="number" min="25" max="200" value="'+esc(value.historyPageSize||100)+'"></label><label>Retención mínima (años)<input name="retentionYears" type="number" min="5" max="20" value="'+esc(value.retentionYears||5)+'"></label></div><label class="check"><input name="notificationsEnabled" type="checkbox" '+(value.notificationsEnabled!==false?'checked':'')+'>Notificaciones nativas en Geotab Drive cuando el permiso ya fue concedido</label><label class="check"><input name="limitsWarningsEnabled" type="checkbox" '+(value.limitsWarningsEnabled!==false?'checked':'')+'>Aviso de límites del sistema en Central (casos activos, almacenamiento y tiempo de consulta)</label><label>Texto adicional de guía Central<textarea name="centralGuide" maxlength="4000">'+esc(value.centralGuide||'')+'</textarea></label><label>Texto adicional de guía Geotab Drive<textarea name="driverGuide" maxlength="4000">'+esc(value.driverGuide||'')+'</textarea></label><p class="info">Los tiempos solo orientan alertas visuales; no son un SLA. Seguridad: PIN con hash y salt, sesiones de 30 minutos, adjuntos privados y acceso por conductor. Diagnóstico: la unidad real de Geotab se comprueba antes de convertir a G.</p><button class="primary">Guardar operación</button></form>';
          this.$('settings-form').onsubmit=event=>{event.preventDefault();const fd=new FormData(event.currentTarget),next={vehicleGroups:String(fd.get('vehicleGroups')).split(',').map(x=>x.trim()).filter(Boolean),driverGroups:String(fd.get('driverGroups')).split(',').map(x=>x.trim()).filter(Boolean),pollMs:Number(fd.get('pollMs')),maxAttachmentBytes:Number(fd.get('maxAttachmentBytes')),historyPageSize:Number(fd.get('historyPageSize')),retentionYears:Number(fd.get('retentionYears')),priorityMinutes:{CRITICA:Number(fd.get('criticalMinutes')),ALTA:Number(fd.get('highMinutes')),MEDIA:Number(fd.get('mediumMinutes')),BAJA:Number(fd.get('lowMinutes'))},notificationsEnabled:fd.has('notificationsEnabled'),limitsWarningsEnabled:fd.has('limitsWarningsEnabled'),centralGuide:fd.get('centralGuide'),driverGuide:fd.get('driverGuide')};this.run(event.submitter,async()=>{await this.service.saveConfig('settings',next);await this.adminContent();await this.refresh();this.toast('Configuración operativa guardada');});};return;
        }
        const items=data[type]||[],kindNames={stop:'Duración de parada',speed:'Velocidad máxima',acceleration:'Aceleración brusca',braking:'Frenada brusca',cornering:'Giro brusco'};
        const selectOptions=(values,selected)=>Object.entries(values).map(([value,label])=>'<option value="'+value+'" '+(value===selected?'selected':'')+'>'+label+'</option>').join('');
        this.$('admin-editor').innerHTML='<div class="list-choice">'+items.map((item,i)=>'<button data-edit="'+i+'">'+esc(item.name)+'<small>'+esc(type==='personnel'?item.area:(item.customLabel||kindNames[item.kind]||item.kind))+' · '+(item.active?'Activo':'Inactivo')+'</small></button>').join('')+'</div><button id="a-new-config" style="margin:12px 0">Agregar '+(type==='personnel'?'personal':'regla')+'</button><div id="a-config-form"></div>';
        const edit=item=>{this.$('config-form').innerHTML='<form id="a-save-config" class="form-stack"><label>Nombre visible<input name="name" required value="'+esc(item.name)+'"></label>'+(type==='personnel'?'<label>Área<input name="area" required value="'+esc(item.area)+'"></label><label class="check"><input name="canManage" type="checkbox" '+(item.canManage!==false?'checked':'')+'>Puede gestionar casos</label>':'<label>ID de la regla en Geotab<input name="geotabRuleId" required value="'+esc(item.geotabRuleId)+'"><small>Identificador interno de la regla que generará los eventos.</small></label><div class="two"><label>Dato que se mostrará<select id="a-kind-select" name="kind">'+selectOptions(kindNames,item.customLabel?'__custom__':item.kind)+'<option value="__custom__"'+(item.customLabel?' selected':'')+'>+ Nuevo tipo…</option></select></label><label id="a-unit-field">Unidad recibida desde Geotab<select name="sourceUnit">'+selectOptions({s:'Segundos — se mostrará HH:MM:SS','km/h':'Kilómetros por hora (km/h)',G:'Fuerza G','m/s2':'Metros por segundo² — se convertirá a G'},item.sourceUnit)+'</select></label></div><div id="a-custom-fields" class="two"'+(item.customLabel?'':' hidden')+'><label>Nombre del dato<input name="customLabel" value="'+esc(item.customLabel||'')+'" placeholder="Ej. Ralentí"></label><label>Cómo se mide<select name="customKind">'+selectOptions({stop:'Duración (HH:MM:SS)',none:'Sin valor (solo alerta)'},item.customLabel?item.kind:'stop')+'</select></label></div><p class="info"><b>Ejemplos:</b> una parada recibida en segundos se mostrará como 00:05:13. Velocidad se mostrará como 92 km/h. Aceleración, frenada y giro se mostrarán en fuerza G. Use m/s² solamente cuando el diagnóstico de Geotab entregue esa unidad.</p><label>Prioridad<select name="priority">'+options(D.PRIORITIES,item.priority)+'</select></label><label class="check"><input name="show" type="checkbox" '+(item.show!==false?'checked':'')+'>Mostrar en Central</label><label class="check"><input name="allowSend" type="checkbox" '+(item.allowSend!==false?'checked':'')+'>Permitir envío al conductor</label>')+'<label class="check"><input name="active" type="checkbox" '+(item.active?'checked':'')+'>Activo</label><button class="primary">Guardar</button></form>';this.$('save-config').onsubmit=event=>{event.preventDefault();const fd=new FormData(event.currentTarget);if(type!=='personnel'&&fd.get('kind')==='__custom__'&&!String(fd.get('customLabel')||'').trim())return this.toast('Escriba el nombre del dato',true);const value={...item,...Object.fromEntries(fd),id:item.id||S.uid(),active:fd.has('active')};if(type==='personnel')value.canManage=fd.has('canManage');else{value.show=fd.has('show');value.allowSend=fd.has('allowSend');if(value.kind==='__custom__'){value.customLabel=String(fd.get('customLabel')||'').trim();value.kind=fd.get('customKind')==='none'?'none':'stop';value.sourceUnit=value.kind==='stop'?'s':'';}else value.customLabel='';delete value.customKind;}this.run(event.submitter,async()=>{await this.service.saveConfig(type,value);await this.adminContent();await this.refresh();this.toast('Configuración guardada');});};
        if(type!=='personnel'&&this.$('kind-select')){const toggleKind=()=>{const custom=this.$('kind-select').value==='__custom__';this.$('unit-field').hidden=custom;this.$('custom-fields').hidden=!custom;};this.$('kind-select').onchange=toggleKind;toggleKind();}
      };
        this.$('admin-editor').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(items[Number(b.dataset.edit)]));this.$('new-config').onclick=()=>edit({active:true,priority:'MEDIA',kind:'stop',sourceUnit:'s'});
      };
      this.$('dialog-body').querySelectorAll('[data-admin]').forEach(b=>b.onclick=()=>{this.$('dialog-body').querySelectorAll('[data-admin]').forEach(x=>x.classList.toggle('active',x===b));render(b.dataset.admin);});render('personnel');
    }
  }
  window.ArdepeUI=ArdepeUI;
})();
