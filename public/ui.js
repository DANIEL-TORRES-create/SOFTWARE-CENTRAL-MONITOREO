(function () {
  'use strict';
  const D = window.ArdepeDomain, S = window.ArdepeServices;
  const esc = text => String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const date = value => value ? new Date(value).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const options = (values, selected) => values.map(value => '<option' + (value === selected ? ' selected' : '') + '>' + esc(value) + '</option>').join('');
  const badge = (value, label) => '<span class="badge ' + esc(value) + '">' + esc(label || value) + '</span>';
  class ArdepeUI {
    constructor(role) { this.role = role; this.cases = []; this.events = []; this.page = 0; this.origin = 'ALL'; this.selected = null; this.mode = 'live'; this.pending = new Map(); }
    $(id) { return document.getElementById('a-' + id); }
    async mount(api) {
      this.pause(); this.api = api;
      this.demo = new URLSearchParams(location.search).get('demo') === '1';
      this.service = this.demo ? new S.DemoService(this.role) : api ? new S.LiveService(api, this.role) : null;
      const root = document.getElementById('ardepe-root'); if (!root) return;
      root.innerHTML = this.layout(); this.bind(); this.mounted = true;
      if (!this.service) { this.status('Abra esta página en ' + (this.role === 'driver' ? 'Geotab Drive' : 'MyGeotab'), true); this.$('list').innerHTML = '<div class="empty"><strong>Conexión Geotab requerida</strong>Puede revisar la interfaz sin conexiones reales.<br><br><a href="?demo=1">Abrir demostración local</a></div>'; return; }
      try {
        if (!this.demo) await this.service.connect();
        await this.refresh(); this.resume();
      } catch (error) { this.status(error.message, true); this.toast(error.message, true); }
    }
    async startup(api, state, callback) {
      try{
        const service=new S.LiveService(api,'driver');await service.connect();const data=await service.bootstrap();
        const unread=(data.cases||[]).filter(c=>c.lastCentralMessageAt>(c.readByDriverAt||'')).length;
        if(unread){const latest=(data.cases||[]).map(c=>c.lastCentralMessageAt||'').sort().pop();await service.notify('Central ARDEPE',unread===1?'Tiene una solicitud nueva de Monitoreo':'Tiene '+unread+' solicitudes nuevas de Monitoreo',latest);}
      }catch(_){}finally{if(callback)callback();}
    }
    layout() {
      const driver = this.role === 'driver';
      const logo = 'https://daniel-torres-create.github.io/SOFTWARE-CENTRAL-MONITOREO/public/assets/logo.png?v=20260919-2';
      const actions = driver
        ? '<div class="commandbar driver-actions"><select id="a-person" hidden><option value=""></option></select><button id="a-create" class="primary"><span class="action-icon">＋</span><span>Reportar</span></button><button id="a-history"><span class="action-icon">▤</span><span>Historial</span></button><button id="a-guide"><span class="action-icon">?</span><span>Ayuda</span></button><button id="a-recover"><span class="action-icon">↻</span><span>Recuperar</span></button></div>'
        : '<div class="commandbar"><div class="operator"><label>Personal activo<select id="a-person"><option value="">Seleccione personal</option></select></label></div><button id="a-history">Histórico</button><button id="a-create" class="primary">Crear caso</button><button id="a-recover">Recuperar envío</button><button id="a-guide">Guía</button><button id="a-admin" aria-label="Administración">⚙</button></div>';
      const tabs = (driver ? [['ALL','Activos'],['NEW','Nuevos'],['DONE','Finalizados']] : [['ALL','Todos activos'],['GEOTAB','Eventos Geotab'],['CENTRAL','Casos Central'],['CONDUCTOR','Reportes conductor']]).map(([id,label]) => '<button data-origin="' + id + '" class="' + (id === 'ALL' ? 'active' : '') + '">' + label + '</button>').join('');
      const filters = driver
        ? '<section class="filters driver-filters"><nav class="tabs" id="a-tabs" aria-label="Casos">' + tabs + '</nav><details class="filter-disclosure"><summary>Buscar y filtrar</summary><div class="filter-row"><select id="a-state" aria-label="Estado"><option value="ALL">Todos los estados activos</option><option value="OLD">Pendientes anteriores</option>' + Object.entries(D.STATES).map(([id,label]) => '<option value="' + id + '">' + label + '</option>').join('') + '</select><select id="a-priority" aria-label="Prioridad"><option value="ALL">Todas las prioridades</option>' + options(D.PRIORITIES) + '</select><input id="a-search" type="search" placeholder="Buscar vehículo o motivo" aria-label="Buscar casos"><button id="a-refresh">Actualizar</button></div></details></section>'
        : '<section class="filters"><nav class="tabs" id="a-tabs" aria-label="Origen">' + tabs + '</nav><div class="filter-row"><select id="a-state" aria-label="Estado"><option value="ALL">Todos los estados activos</option><option value="OLD">Pendientes anteriores</option>' + Object.entries(D.STATES).map(([id,label]) => '<option value="' + id + '">' + label + '</option>').join('') + '</select><select id="a-priority" aria-label="Prioridad"><option value="ALL">Todas las prioridades</option>' + options(D.PRIORITIES) + '</select><input id="a-search" type="search" placeholder="Buscar placa, conductor o motivo" aria-label="Buscar casos"><button id="a-refresh">Actualizar</button></div></section>';
      return '<div class="shell ' + (driver ? 'driver-shell' : '') + '">' +
        '<header class="topbar"><img class="logo" src="' + logo + '" alt="ARDEPE SAC"><div class="title"><h1>' + (driver ? 'Mis atenciones' : 'Central Integral de Monitoreo') + '</h1><p>ARDEPE · Seguridad vial</p></div><div class="identity"><span id="a-connection" class="connection">Preparando conexión</span><div id="a-identity" class="muted"></div></div></header>' +
        (this.demo ? '<div class="demo-banner"><strong>DEMOSTRACIÓN LOCAL</strong><span>Datos simulados. No envía información real.</span><a target="_blank" href="' + (driver ? 'centralArdepe' : 'conductorArdepe') + '.html?demo=1">Abrir ' + (driver ? 'Central' : 'vista del conductor') + '</a></div>' : '') +
        actions +
        '<section class="metrics" id="a-metrics" aria-label="Resumen"></section>' +
        filters +
        '<div id="a-history-banner" class="history-banner" hidden><span id="a-history-label"></span><button id="a-live">Volver a activos</button><button id="a-export-all">Exportar consulta</button></div>' +
        '<main class="workspace"><aside class="panel queue-panel"><header class="panel-heading"><h2 id="a-queue-title">' + (driver ? 'Tus atenciones' : 'Cola de atención') + '</h2><small id="a-count">0 casos</small></header><div class="scroll" id="a-list"><div class="empty"><span class="spinner"></span>Consultando…</div></div><div class="pager"><button id="a-prev" aria-label="Página anterior">Anterior</button><span id="a-page"></span><button id="a-next">Siguiente</button></div></aside><section class="panel context-panel"><header class="panel-heading"><h2>Detalle del caso</h2><span>Información operativa</span></header><div id="a-context" class="scroll"><div class="empty">Seleccione un caso para revisar su contexto.</div></div></section><section class="panel management-panel"><header class="panel-heading"><h2>' + (driver ? 'Detalle y conversación' : 'Atención y conversación') + '</h2><small id="a-manager"></small></header><div id="a-work" class="scroll">' + (driver ? '<div class="empty"><strong>Seleccione una atención</strong>Aquí podrá revisar el detalle, conversar y adjuntar evidencias.</div>' : '<div class="operation-start"><h3>Ruta de atención</h3><ol><li><span>1</span>Validar evento y conductor</li><li><span>2</span>Elegir canal de contacto</li><li><span>3</span>Evaluar respuesta y causa</li><li><span>4</span>Registrar acciones y seguimiento</li><li><span>5</span>Finalizar con expediente completo</li></ol><p>Seleccione un caso de la cola o use <b>Crear caso</b> para comenzar.</p></div>') + '</div></section></main></div>' +
        '<dialog id="a-dialog" class="modal"><header><h2 id="a-dialog-title"></h2><button id="a-close" aria-label="Cerrar">×</button></header><div id="a-dialog-body" class="body"></div></dialog><div id="a-toast" class="toast" role="status" hidden></div><div id="a-print" class="print-view"></div>';
    }
    bind() {
      this.$('refresh').onclick = () => this.run(this.$('refresh'), () => this.refresh());
      this.$('tabs').onclick = event => { const button = event.target.closest('[data-origin]'); if (!button) return; this.origin = button.dataset.origin; this.page = 0; this.$('tabs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button)); this.renderList(); };
      ['state','priority','search'].forEach(id => this.$(id).addEventListener('input', () => { this.page = 0; this.renderList(); }));
      this.$('person').onchange = () => { sessionStorage.setItem('ardepe-person', this.$('person').value); if (this.selected) this.renderWork(); };
      this.$('prev').onclick = () => { this.page = Math.max(0, this.page - 1); this.renderList(); };
      this.$('next').onclick = () => {
        const localPages=Math.max(1,Math.ceil(this.filtered().length/25));
        if(this.mode==='cases'&&this.page>=localPages-1&&this.historyNextToken)return this.run(this.$('next'),async()=>{const result=await this.service.history(this.historyQuery.from,this.historyQuery.to,this.historyNextToken);this.historyRows=this.historyRows.concat(result.cases);this.historyNextToken=result.nextPageToken||'';this.page++;this.renderList();this.metrics();});
        this.page++; this.renderList();
      };
      this.$('close').onclick = () => this.$('dialog').close();
      this.$('create').onclick = () => this.createDialog(); this.$('history').onclick = () => this.historyDialog();
      this.$('live').onclick = () => { this.mode = 'live'; this.$('history-banner').hidden = true; this.$('state').value = 'ALL'; this.refresh().catch(e => this.toast(e.message, true)); };
      this.$('recover').hidden=true;
      this.$('recover').onclick=()=>this.run(this.$('recover'),async()=>{if(!this.service.recoverPending)throw new Error('Conecte Geotab primero');const result=await this.service.recoverPending();this.pending.clear();this.selected=result;await this.refresh();this.renderContext();this.renderWork();this.toast('Envío confirmado y recuperado');});
      this.$('guide').onclick = () => this.guide();
      this.$('export-all').onclick = () => this.run(this.$('export-all'), () => this.exportCases(this.filtered().filter(c => c.version)));
      if (this.$('admin')) this.$('admin').onclick = () => this.adminDialog();
    }
    status(message, error) { this.$('connection').textContent = message; this.$('connection').className = 'connection' + (error ? ' error' : ''); }
    toast(message, error) { this.$('toast').textContent = message; this.$('toast').className = 'toast' + (error ? ' error' : ''); this.$('toast').hidden = false; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { if (this.$('toast')) this.$('toast').hidden = true; }, 8000); }
    async run(button, fn) { if (button.disabled) return; const text = button.textContent; button.disabled = true; button.innerHTML = '<span class="spinner"></span>Procesando…'; try { await fn(); } catch (error) { this.toast(error.message, true); } finally { if (button.isConnected) { button.disabled = false; button.textContent = text; } } }
    pause() { clearInterval(this.timer); clearInterval(this.clock); }
    resume() { if (!this.mounted || !this.service) return; this.pause(); const poll=Math.min(120000,Math.max(5000,Number(this.service.settings&&this.service.settings.pollMs)||window.ARDEPE_CONFIG.pollMs));this.timer = setInterval(() => { if (this.mode === 'live') this.refresh().catch(e => this.status(e.message, true)); }, poll); this.clock = setInterval(() => this.tick(), 1000); }
    async refresh() {
      if (!this.service || this.refreshing || this.mode !== 'live') return;
      this.refreshing = true; this.status('Actualizando…');
      try {
        const previousUnread=this.role==='driver'?this.cases.filter(c=>this.unread(c)).length:0;
        const data = await this.service.bootstrap(); this.people = data.personnel || []; this.rules = data.rules || []; this.cases = data.cases || []; this.events = data.events || [];
        const unreadNow=this.role==='driver'?this.cases.filter(c=>this.unread(c)).length:0;
        if(this.role==='driver'&&unreadNow>previousUnread&&previousUnread>=0){const latest=this.cases.map(c=>c.lastCentralMessageAt||'').sort().pop();this.service.notify('Central ARDEPE',unreadNow===1?'Tiene una solicitud nueva de Monitoreo':'Tiene '+unreadNow+' solicitudes nuevas de Monitoreo',latest);}
        this.$('identity').textContent = this.role === 'driver' ? data.actor.name : 'Hora operativa · Lima';
        const old = this.$('person').value || sessionStorage.getItem('ardepe-person');
        this.$('person').innerHTML = '<option value="">Seleccione personal</option>' + this.people.filter(p => p.active).map(p => '<option value="' + esc(p.id) + '">' + esc(p.name + ' · ' + p.area) + '</option>').join('');
        if (this.people.some(p => p.active && p.id === old)) this.$('person').value = old;
        if (this.demo && !this.$('person').value) this.$('person').value = 'demo-operator';
        this.renderList(); this.metrics();
        if (this.selected && this.selected.version) {
          const fresh = this.cases.find(c => c.id === this.selected.id);
          if (fresh && fresh.version !== this.selected.version) { this.selected = fresh; this.renderContext(); this.renderWork(true); }
        }
        await this.updateRecovery();
        this.status(this.demo ? 'Demostración conectada' : 'Conectado · ' + new Date().toLocaleTimeString('es-PE'));
      } finally { this.refreshing = false; }
    }
    async updateRecovery() {
      if (!this.$('recover') || this.demo || !this.service || !this.service.pendingCommand) return;
      this.$('recover').hidden = !(await this.service.pendingCommand());
    }
    all() {
      if (this.mode !== 'live') return this.historyRows || [];
      const keys = new Set(this.cases.flatMap(c => c.eventKeys));
      return [...this.cases, ...this.events.filter(e => !keys.has(e.eventKey))];
    }
    filtered() {
      const state = this.$('state').value, priority = this.$('priority').value, query = this.$('search').value.toLocaleLowerCase(), today = D.limaDay(new Date());
      return this.all().filter(c => {
        if (this.role === 'driver' && c.driverId !== this.service.actor.id) return false;
        if (this.origin === 'DONE' && c.status !== 'FINALIZADA') return false;
        if (this.origin === 'NEW' && !this.unread(c)) return false;
        if (!['ALL','DONE','NEW'].includes(this.origin) && c.origin !== this.origin) return false;
        if (state === 'ALL' && this.mode === 'live' && this.origin !== 'DONE' && c.status === 'FINALIZADA') return false;
        if (state === 'OLD' && (c.status === 'FINALIZADA' || D.limaDay(c.occurredAt) >= today)) return false;
        if (!['ALL','OLD'].includes(state) && c.status !== state) return false;
        if (priority !== 'ALL' && c.priority !== priority) return false;
        return !query || [c.title,c.plate,c.driverName,c.location].join(' ').toLocaleLowerCase().includes(query);
      }).sort((a,b) => D.PRIORITIES.indexOf(a.priority) - D.PRIORITIES.indexOf(b.priority) || a.occurredAt.localeCompare(b.occurredAt));
    }
    unread(c) { return this.role === 'driver' ? c.lastCentralMessageAt > (c.readByDriverAt || '') : c.lastDriverMessageAt > (c.readByCentralAt || ''); }
    renderList() {
      const rows = this.filtered(), pages = Math.max(1, Math.ceil(rows.length / 25)); this.page = Math.min(this.page, pages - 1);
      this.$('count').textContent = rows.length + ' casos'; this.$('page').textContent = (this.page + 1) + ' / ' + pages;
      this.$('prev').disabled = this.page === 0; this.$('next').disabled = this.page >= pages - 1 && !(this.mode==='cases'&&this.historyNextToken);
      const ready = (this.people||[]).some(p=>p.active) && (this.rules||[]).some(r=>r.active);
      const empty = this.mode === 'live'
        ? (this.role === 'driver' ? '<div class="empty app-empty"><span class="empty-mark">✓</span><strong>Todo está al día</strong>No tienes solicitudes ni casos activos.<br>Usa <b>Reportar</b> si necesitas informar un incidente.</div>' : ready ? '<div class="empty app-empty"><span class="empty-mark">✓</span><strong>Sistema listo y sin casos</strong>Use <b>Crear caso</b> o revise <b>Eventos Geotab</b> para iniciar la primera atención.</div>' : '<div class="empty setup-empty"><strong>Complete la configuración inicial</strong><ol><li>Abra Administración.</li><li>Registre el personal de Monitoreo.</li><li>Registre y active las reglas Geotab.</li><li>Seleccione el personal activo y actualice la bandeja.</li></ol><span>Esta implementación inicia sin registros anteriores.</span></div>')
        : '<div class="empty app-empty"><span class="empty-mark">○</span><strong>Sin registros nuevos</strong>No existen atenciones de esta implementación en el periodo consultado.</div>';
      this.$('list').innerHTML = rows.length ? rows.slice(this.page * 25, this.page * 25 + 25).map(c => {const minutes=Number(this.service.settings&&this.service.settings.priorityMinutes&&this.service.settings.priorityMinutes[c.priority]),alert=c.status!=='FINALIZADA'&&minutes>0&&D.seconds(c.occurredAt,new Date().toISOString())>=minutes*60;return '<button class="queue-row ' + (this.selected && this.selected.id === c.id ? 'selected ' : '')+(alert?'overdue':'')+'" data-case="' + esc(c.id) + '"><div class="row-head"><strong>' + esc(c.plate || c.type || 'Caso') + '</strong>' + badge(c.priority) + '</div><p>' + esc(c.title) + '</p><small>' + esc(c.driverName || 'Conductor por confirmar') + '</small><div class="meta">' + badge(c.status, D.STATES[c.status]) + '<small>' + (alert?'Alerta operativa · ':this.unread(c)?'Mensaje nuevo · ':'') + date(c.occurredAt) + '</small></div></button>';}).join('') : empty;
      this.$('list').querySelectorAll('[data-case]').forEach(button => button.onclick = () => this.run(button, () => this.select(rows.find(c => c.id === button.dataset.case))));
    }
    metrics() {
      const rows = this.all(), open = rows.filter(c => c.status !== 'FINALIZADA'), now = new Date().toISOString();
      const list = [ ['Por gestionar', open.filter(c => c.status === 'NUEVO').length], ['En atención', open.filter(c => c.status !== 'NUEVO').length], [this.role === 'driver' ? 'Sin leer' : 'Respuesta recibida', this.role === 'driver' ? rows.filter(c => this.unread(c)).length : rows.filter(c => c.status === 'RESPUESTA_RECIBIDA').length], ['Finalizadas hoy', rows.filter(c => c.finalizedAt && D.limaDay(c.finalizedAt) === D.limaDay(now)).length], ['Mayor tiempo activo', D.elapsed(open.reduce((m,c) => Math.max(m,D.seconds(c.occurredAt,now)),0))] ];
      this.$('metrics').innerHTML = list.slice(0,this.role === 'driver' ? 3 : 5).map(([label,value]) => '<div class="metric"><small>' + label + '</small><strong>' + value + '</strong></div>').join('');
    }
    async select(item) {
      this.selected = item; if (this.role === 'driver') document.querySelector('.driver-shell').classList.add('case-open'); this.renderList(); this.renderContext(); this.renderWork();
      if (item.version) {
        const fresh = await this.service.detail(item.id); if (!this.selected || this.selected.id !== item.id) return;
        this.selected = fresh; this.renderContext(); this.renderWork(true);
        if (this.unread(fresh)) { await this.command('read', {}, fresh); }
      } else if (this.service.resolve) {
        this.$('context').insertAdjacentHTML('afterbegin','<div class="info"><span class="spinner"></span>Consultando conductor, ubicación y valor…</div>');
        const fresh = await this.service.resolve(item); if (!this.selected || this.selected.id !== item.id) return; this.selected = fresh; this.renderContext(); this.renderWork(true);
      }
    }
    contextHTML(c, compact) {
      const coord = typeof c.latitude === 'number' && typeof c.longitude === 'number';
      return '<div class="content">' + badge(c.status, D.STATES[c.status]) + '<h2 class="detail-title">' + esc(c.title) + '</h2><small>' + date(c.occurredAt) + ' · ' + esc(c.origin) + '</small><dl class="facts"><div><dt>Vehículo</dt><dd>' + esc(c.plate || 'Por confirmar') + '</dd></div><div><dt>Valor detectado</dt><dd>' + esc(c.measurement ? c.measurement.text : 'No aplica') + '</dd></div><div class="wide"><dt>Conductor</dt><dd>' + esc(c.driverName || 'Por confirmar') + '</dd></div><div class="wide"><dt>Ubicación</dt><dd>' + esc(c.location || 'No disponible') + '</dd></div><div class="wide"><dt>Personal asignado</dt><dd>' + esc(c.operator ? c.operator.name + ' · ' + c.operator.area : 'Sin iniciar') + '</dd></div></dl>' +
        (!compact && coord ? '<div class="map"><iframe title="Ubicación del evento" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=' + encodeURIComponent([c.longitude-.012,c.latitude-.007,c.longitude+.012,c.latitude+.007].join(',')) + '&layer=mapnik&marker=' + encodeURIComponent(c.latitude+','+c.longitude) + '"></iframe></div><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=' + c.latitude + '&mlon=' + c.longitude + '#map=16/' + c.latitude + '/' + c.longitude + '">Ampliar mapa</a>' : '') +
        '<p class="section-label">Detalle inicial</p><p>' + esc(c.description) + '</p>' + (c.result ? '<p class="section-label">Resultado</p><p>' + esc(c.result) + '</p>' : '') +
        ((c.events||[]).length ? '<p class="section-label">Eventos asociados ('+c.events.length+')</p>'+c.events.map(e=>'<p>'+esc(e.title)+' · '+date(e.occurredAt)+' · '+esc(e.measurement?e.measurement.text:'Valor no disponible')+'</p>').join('') : '') + '<div class="timing"><div><small>Tiempo total</small><strong data-time="total">—</strong></div><div><small>Hasta inicio atención</small><strong data-time="toStart">—</strong></div><div><small>Espera de conductor</small><strong data-time="waiting">—</strong></div><div><small>Seguimiento</small><strong data-time="followUp">—</strong></div></div></div>';
    }
    renderContext() { this.$('context').innerHTML = this.contextHTML(this.selected, false); this.tick(); }
    renderWork(preserve = false) {
      const c = this.selected; if (!c) return;
      const saved = {};
      if (preserve) this.$('work').querySelectorAll('input:not([type=file]),textarea,select').forEach(el => { saved[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
      const fileInput = preserve ? this.$('work').querySelector('input[type=file]') : null;
      const mine = this.role === 'driver' || c.operator && c.operator.id === this.$('person').value;
      const closed = c.status === 'FINALIZADA';
      const sendAllowed=this.role==='driver' || !(c.eventKeys||[]).length || (c.events||[]).length>0 && c.events.every(e=>{const r=this.rules.find(r=>r.id===e.ruleId);return r && r.active && r.allowSend===true;});
      const workflow=this.role==='central'?'<nav class="workflow-strip" aria-label="Etapas de atención"><span>1. Validar</span><span>2. Comunicar</span><span>3. Evaluar</span><span>4. Actuar</span><span>5. Finalizar</span></nav>':'';
      this.$('manager').textContent = c.operator ? c.operator.name : '';
      this.$('work').innerHTML = (this.role === 'driver' ? '<div class="mobile-case-nav"><button id="a-mobile-back">‹ Volver a mis atenciones</button></div>' : '') + workflow + '<div class="detail-inline">' + this.contextHTML(c,true) + '</div><div class="content">' +
        (this.role === 'central' ? '<div class="context-actions">' + (!c.version || !c.operator ? '<button id="a-take" class="primary">Iniciar atención</button>' : '') + (c.version && !closed ? '<button id="a-change-driver">Cambiar conductor</button>' : '') + (c.version && !closed && mine ? '<button id="a-associate">Asociar eventos</button>' : '') + (c.version ? '<button id="a-export">Exportar PDF</button>' : '') + '</div>' : '') +
        (!c.version ? '<div class="info">El evento todavía no se guarda en Sheets. Inicie la atención para registrar el caso.</div>' : '') +
        '<p class="section-label">Conversación y evidencias</p><div id="a-messages">' + this.messagesHTML(c) + '</div>' +
        (c.version && !closed ? '<form id="a-message-form" class="form-stack"><fieldset ' + (!mine || !sendAllowed ? 'disabled' : '') + ' class="form-stack"><label>' + (this.role === 'driver' ? 'Mi respuesta o información adicional' : 'Mensaje al conductor') + '<textarea name="text" required maxlength="6000" placeholder="Escriba información clara sobre este caso."></textarea></label><label>Adjuntar imagen, PDF o documento<input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.txt,.docx,.xlsx"><small>Hasta 3 archivos · 3 MB cada uno después de optimizar imágenes · sin video</small></label>' + (this.role === 'central' ? '<label class="check"><input type="checkbox" name="requiresResponse" checked>Solicitar respuesta del conductor</label><label class="check"><input type="checkbox" name="clarification">Es una solicitud de aclaración</label>' : '') + '<button class="primary" type="submit">Enviar mensaje</button></fieldset></form>' : closed ? '<div class="info">Atención finalizada. La conversación y las evidencias se conservan para consulta.</div>' : '') +
        (this.role === 'central' && c.version && !closed ? this.managementHTML(mine) : '') +
        (c.managements && c.managements.length ? '<p class="section-label">Gestiones registradas</p>' + c.managements.map(m => '<article class="message"><strong>' + esc(m.result) + '</strong><p>' + esc(m.summary) + '</p><p>' + esc(m.immediateAction) + '</p><small>' + esc(m.person.name) + ' · ' + date(m.at) + '</small></article>').join('') : '') + '</div>';
      if (preserve) this.$('work').querySelectorAll('input:not([type=file]),textarea,select').forEach(el => { if (Object.hasOwn(saved,el.name)) { if (el.type === 'checkbox') el.checked = saved[el.name]; else el.value = saved[el.name]; } });
      if (fileInput && this.$('work').querySelector('input[type=file]')) this.$('work').querySelector('input[type=file]').replaceWith(fileInput);
      if (this.$('take')) this.$('take').onclick = () => this.run(this.$('take'), () => this.take());
      if (this.$('mobile-back')) this.$('mobile-back').onclick = () => this.closeMobileCase();
      if (this.$('change-driver')) this.$('change-driver').onclick = () => this.driverDialog();
      if (this.$('export')) this.$('export').onclick = () => this.run(this.$('export'), () => this.exportCases([c]));
      if (this.$('message-form')) this.$('message-form').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; this.run(event.submitter, async () => { const data = new FormData(form), attachments = await this.prepareFiles(form.elements.files.files); await this.command('message',{ text:data.get('text'), requiresResponse:data.has('requiresResponse'), clarification:data.has('clarification'), attachments }); this.renderWork(); this.toast('Mensaje registrado'); }); };
      if (this.$('manage-form')) this.$('manage-form').onsubmit = event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); this.run(event.submitter, async () => { await this.command('manage',payload); this.renderWork(); this.toast('Gestión registrada'); }); };
      this.$('work').querySelectorAll('[data-evidence]').forEach(button => button.onclick = () => this.run(button, () => this.showEvidence(c.attachments.find(a => a.id === button.dataset.evidence),button)));
      if(this.$('associate'))this.$('associate').onclick=()=>this.associateDialog();
      if(!sendAllowed && c.version && !closed)this.$('messages').insertAdjacentHTML('afterend','<p class="info">La regla no permite enviar mensajes al conductor. Puede registrar la gestión interna.</p>');
      this.tick();
    }
    closeMobileCase() {
      this.selected = null;
      const shell = document.querySelector('.driver-shell'); if (shell) shell.classList.remove('case-open');
      this.$('work').innerHTML = '<div class="empty"><strong>Seleccione una atención</strong>Aquí podrá revisar el detalle, conversar y adjuntar evidencias.</div>';
      this.renderList();
    }
    messagesHTML(c) {
      if (!c.messages || !c.messages.length) return '<p class="muted" style="margin:12px 0">Todavía no hay mensajes en este caso.</p>';
      return c.messages.map(m => '<article class="message ' + m.role + '"><header><strong>' + esc(m.author) + '</strong><small>' + (m.role === 'central' ? 'Monitoreo' : 'Conductor') + '</small></header><p>' + esc(m.text) + '</p><small>' + date(m.at) + (m.requiresResponse ? ' · Solicita respuesta' : '') + '</small>' + (c.attachments || []).filter(a => a.messageId === m.id).map(a => '<button class="attachment-name" data-evidence="' + esc(a.id) + '">Ver ' + esc(a.name) + '</button>').join('') + '</article>').join('');
    }
    managementHTML(enabled) {
      return '<details class="section-box"><summary>Evaluación, acciones y finalización</summary><form id="a-manage-form" class="form-stack"><fieldset class="form-stack" ' + (!enabled ? 'disabled' : '') + '><div class="two"><label>Resultado<select name="result" required><option value="">Seleccionar</option>' + options(D.RESULTS) + '</select></label><label>Canal de atención<select name="channel">' + options(D.CHANNELS) + '</select></label></div><label>Causa identificada<select name="cause">' + options(D.CAUSES,'No determinada') + '</select></label><label>Acción inmediata<textarea name="immediateAction" required></textarea></label><label>Acción correctiva o preventiva<select name="action">' + options(D.ACTIONS) + '</select></label><label>Detalle de acción<textarea name="correctiveAction"></textarea></label><label>Estado al guardar<select name="status"><option value="EN_GESTION">Continuar en gestión</option>' + D.FOLLOW_STATES.map(s => '<option value="' + s + '">' + D.STATES[s] + '</option>').join('') + '<option value="FINALIZADA">Atención finalizada</option></select></label><div class="two"><label>Responsable de seguimiento<input name="owner"></label><label>Fecha compromiso<input name="dueDate" type="date"></label></div><label>Resumen de la atención<textarea name="summary" required></textarea></label><label>Observación complementaria<textarea name="notes"></textarea></label><button type="submit" class="primary">Registrar gestión</button></fieldset></form></details>';
    }
    tick() { if (!this.selected || !this.mounted) return; const c = this.selected, times = c.version ? D.times(c,new Date().toISOString()) : { total:D.seconds(c.occurredAt,new Date().toISOString()),toStart:D.seconds(c.occurredAt,new Date().toISOString()),waiting:0,followUp:0 }; document.querySelectorAll('[data-time]').forEach(el => el.textContent = D.elapsed(times[el.dataset.time])); }
    async command(type, payload, current = this.selected) {
      const id = type === 'create' ? payload.caseId || D.month(new Date()) + '_' + S.uid() : current.id;
      const signature = JSON.stringify({type,payload,id,person:this.$('person').value});
      let command = this.pending.get(signature);
      if (!command) { command = { type, payload, caseId:id, version:current && current.version || 0, operationId:S.uid(),receipt:S.uid() }; this.pending.set(signature,command); }
      try {
        const result = await this.service.command(command,this.$('person').value);
        this.pending.delete(signature); this.cases = this.cases.filter(c => c.id !== result.id).concat(result); this.selected = result;
        if (this.role === 'driver') document.querySelector('.driver-shell').classList.add('case-open');
        if (this.mode !== 'live') this.historyRows = (this.historyRows || []).map(c => c.id === result.id ? result : c);
        this.renderContext(); this.renderWork(true); this.renderList(); this.metrics(); await this.updateRecovery(); return result;
      } catch (error) { if (!error.uncertain) this.pending.delete(signature); else if(this.$('recover'))this.$('recover').hidden=false; throw error; }
    }
    async take() { const c = this.selected; if (!c.version) await this.command('create',{...c,caseId:c.caseId || (c.caseId=D.month(new Date())+'_'+S.uid())}); else await this.command('take',{}); this.renderWork(); this.toast('Atención iniciada'); }
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
      this.dialog(this.role === 'driver' ? 'Reportar incidente' : 'Crear caso','<div class="empty"><span class="spinner"></span>Preparando formulario…</div>');
      try {
        const drivers = this.role === 'central' ? await this.service.drivers() : [], devices = await this.service.devices(), mobile=this.role==='driver'&&this.service.mobileContext?await this.service.mobileContext():{};
        const local = new Date(Date.now()-18000000).toISOString().slice(0,16);
        this.dialog(this.role === 'driver' ? 'Reportar incidente' : 'Crear caso','<form id="a-create-form" class="form-stack"><div class="two"><label>Tipo<select name="type">' + options(D.TYPES) + '</select></label><label>Prioridad<select name="priority">' + options(D.PRIORITIES,'MEDIA') + '</select></label></div>' + (this.role === 'central' ? '<label>Conductor<select name="driverId" required><option value="">Seleccione conductor</option>' + drivers.map(d => '<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>').join('') + '</select></label>' : '<div class="info">Conductor: '+esc(this.service.actor.name)+(mobile.plate?' · Vehículo: '+esc(mobile.plate):' · Vehículo no detectado')+(mobile.location?' · Ubicación detectada':' · Ubicación no disponible')+'</div>') + '<div class="two"><label>Vehículo<select name="deviceId"><option value="">No disponible</option>' + devices.map(d => '<option value="'+esc(d.id)+'" '+(d.id===mobile.deviceId?'selected':'')+'>'+esc(d.name)+'</option>').join('') + '</select></label><label>Fecha y hora · Lima<input name="occurredAt" type="datetime-local" value="'+local+'" required></label></div><label>Ubicación<input name="location" maxlength="500" value="'+esc(mobile.location||'')+'"></label><input type="hidden" name="latitude" value="'+esc(mobile.latitude??'')+'"><input type="hidden" name="longitude" value="'+esc(mobile.longitude??'')+'"><label>Descripción / motivo<textarea name="description" required maxlength="6000"></textarea></label><div class="two"><label>Daños<input name="damages" maxlength="500"></label><label>Personas afectadas<input name="affected" maxlength="500"></label></div><label>'+(this.role==='central'?'Mensaje inicial al conductor':'Comentario adicional')+'<textarea name="initialMessage" '+(this.role==='central'?'required':'')+' maxlength="6000"></textarea></label><label>Adjuntar evidencia<input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.txt,.docx,.xlsx"><small>Hasta 3 archivos · sin video</small></label>'+(this.role==='central'?'<label class="check"><input name="requiresResponse" type="checkbox" checked>Requiere respuesta del conductor</label>':'')+'<button class="primary">Crear caso y registrar información</button></form>');
        this.$('create-form').onsubmit = event => { event.preventDefault(); const fd=new FormData(event.currentTarget),payload=Object.fromEntries(fd);delete payload.files;const initialMessage=String(payload.initialMessage||'').trim(),requiresResponse=fd.has('requiresResponse');delete payload.initialMessage;delete payload.requiresResponse; payload.occurredAt = new Date(payload.occurredAt+'-05:00').toISOString(); payload.title = payload.type; payload.driverName = (drivers.find(d=>d.id===payload.driverId)||{}).name||''; payload.plate = (devices.find(d=>d.id===payload.deviceId)||{}).name||''; payload.caseId = this.createCaseId || (this.createCaseId=D.month(new Date())+'_'+S.uid()); this.run(event.submitter,async()=>{const attachments=await this.prepareFiles([...event.currentTarget.elements.files.files]);await this.command('create',payload);if(initialMessage||attachments.length)await this.command('message',{text:initialMessage||'Evidencia inicial del caso',requiresResponse,attachments});this.createCaseId=null;this.$('dialog').close();this.renderWork();this.toast('Caso e información inicial registrados'); }); };
      } catch(error) { this.toast(error.message,true); }
    }
    historyDialog() {
      this.dialog('Consulta histórica','<form id="a-history-form" class="form-stack"><label>Consultar<select name="source"><option value="cases">Historial de atenciones</option>' + (this.role==='central'?'<option value="events">Eventos Geotab por gestionar</option>':'') + '</select></label><div class="presets"><button type="button" data-preset="today">Hoy</button><button type="button" data-preset="yesterday">Ayer</button><button type="button" data-preset="7days">Últimos 7 días</button></div><div class="two"><label>Desde · Lima<input name="from" type="datetime-local" step="1" required></label><label>Hasta · Lima<input name="to" type="datetime-local" step="1" required></label></div><label>Regla (obligatoria para eventos Geotab)<select name="rule"><option value="">Seleccionar regla</option>' + (this.rules||[]).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>').join('') + '</select></label><p class="muted">Geotab: máximo 7 días. Atenciones: hasta un año por consulta. Los pendientes antiguos siguen en la vista activa.</p><button class="primary">Consultar</button></form>');
      const form=this.$('history-form');
      const setPreset=key=>{ const range=D.preset(key); for(const [name,value] of Object.entries(range)) form.elements[name].value=new Date(Date.parse(value)-18000000).toISOString().slice(0,19); form.querySelectorAll('[data-preset]').forEach(b=>{b.classList.toggle('active',b.dataset.preset===key);b.setAttribute('aria-pressed',String(b.dataset.preset===key));}); };
      form.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>setPreset(b.dataset.preset));setPreset('yesterday');
      ['from','to'].forEach(name=>form.elements[name].oninput=()=>form.querySelectorAll('[data-preset]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');}));
      form.onsubmit=event=>{event.preventDefault();const value=Object.fromEntries(new FormData(form));this.run(event.submitter,async()=>{const from=new Date(value.from+'-05:00').toISOString(),to=new Date(value.to+'-05:00').toISOString();if(value.source==='events'){this.historyRows=await this.service.explore(from,to,value.rule);this.historyNextToken='';}else{const result=await this.service.history(from,to);this.historyRows=result.cases;this.historyNextToken=result.nextPageToken||'';this.historyQuery={from,to};} this.mode=value.source;this.origin='ALL';this.$('tabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.origin==='ALL'));this.$('state').value='ALL';this.$('priority').value='ALL';this.$('search').value='';this.$('history-label').textContent=(value.source==='events'?'Eventos Geotab por gestionar':'Historial de atenciones')+' · '+date(from)+' — '+date(to);this.$('history-banner').hidden=false;this.$('dialog').close();this.page=0;this.renderList();this.metrics();});};
    }
    guide() {
      const extra=this.service.settings&&(this.role==='driver'?this.service.settings.driverGuide:this.service.settings.centralGuide);
      const driverGuide = '<section><h3>Cuando Monitoreo envía una solicitud</h3><ol><li>Abra <b>Nuevos</b> y seleccione la atención.</li><li>Revise vehículo, fecha, lugar y valor detectado.</li><li>Escriba su versión con información concreta y adjunte fotos o documentos si corresponde.</li><li>Pulse <b>Enviar mensaje</b>. Si Monitoreo solicita una aclaración, responda dentro del mismo caso.</li></ol></section><section><h3>Para informar un hecho</h3><ol><li>Pulse <b>Reportar</b>.</li><li>Seleccione el tipo de incidente y confirme vehículo, fecha, ubicación y prioridad.</li><li>Describa lo ocurrido, daños y personas afectadas. Adjunte evidencia disponible.</li><li>Envíe el reporte una sola vez. Si la red falla, use <b>Recuperar</b>.</li></ol></section><section><h3>Cómo se organiza la aplicación</h3><p><b>Activos</b> reúne casos pendientes. <b>Nuevos</b> muestra mensajes sin leer. <b>Finalizados</b> conserva únicamente las atenciones creadas desde esta implementación. Los mensajes enviados no se editan; cualquier corrección se agrega como un mensaje nuevo.</p></section>';
      const centralGuide = '<section><h3>1. Preparar la atención</h3><ol><li>Seleccione el personal activo. Sin operador no se puede asumir ni gestionar un caso.</li><li>Revise la bandeja por origen: evento Geotab, caso creado por Central o reporte del conductor.</li><li>Consultar un evento Geotab no lo guarda. Se registra cuando pulsa <b>Iniciar atención</b>.</li></ol></section><section><h3>2. Atender y comunicarse</h3><ol><li>Valide conductor, vehículo, ubicación y valor detectado.</li><li>Elija la ruta operativa: solicitar descargo por Drive, registrar contacto telefónico, validar internamente o documentar que no amerita descargo.</li><li>Los mensajes y evidencias quedan vinculados al caso. Las correcciones se registran como nuevas entradas.</li></ol></section><section><h3>3. Evaluar y finalizar</h3><ol><li>Registre resultado, causa, canal y acción.</li><li>Si existe seguimiento, indique responsable y fecha compromiso.</li><li>Use <b>Atención finalizada</b> solamente cuando el expediente esté completo. El resultado se conserva separado del estado.</li></ol></section><section><h3>4. Consultas y documentos</h3><p>Histórico muestra únicamente casos creados desde esta implementación. Eventos Geotab por gestionar consulta la API sin guardar eventos. El PDF se genera bajo demanda con la información actual y no se almacena.</p></section>';
      this.dialog('Guía '+(this.role==='driver'?'del conductor':'de operación'),'<div class="guide guide-sections">'+(this.role==='driver'?driverGuide:centralGuide)+'<div class="info"><b>Valores:</b> paradas en HH:MM:SS, velocidad en km/h y maniobras en G.</div>'+(extra?'<p class="guide-extra">'+esc(extra)+'</p>':'')+'</div>');
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
      if(file.mimeType.startsWith('image/')) {const img=document.createElement('img');img.src=dataUrl;img.alt=file.name;button.replaceWith(img);}
      else {const blob=await (await fetch(dataUrl)).blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    }
    async exportCases(cases) {
      if(!cases.length)throw new Error('No hay atenciones guardadas para exportar');
      if(cases.length>100)throw new Error('Filtre la consulta a un máximo de 100 casos por exportación');
      const rows=[];for(const item of cases)rows.push(await this.service.detail(item.id));
      const bytes=await window.ArdepePDF.generate(rows,file=>this.service.evidence(file));
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
          this.$('admin-editor').innerHTML='<form id="a-settings-form" class="form-stack"><div class="two"><label>Grupos de vehículos (coma)<input name="vehicleGroups" required value="'+esc((value.vehicleGroups||[]).join(', '))+'"></label><label>Grupos de conductores (coma)<input name="driverGroups" required value="'+esc((value.driverGroups||[]).join(', '))+'"></label></div><div class="two"><label>Actualización automática (ms)<input name="pollMs" type="number" min="5000" max="120000" value="'+esc(value.pollMs||15000)+'"></label><label>Límite por adjunto (bytes)<input name="maxAttachmentBytes" type="number" min="100000" max="3000000" value="'+esc(value.maxAttachmentBytes||3000000)+'"></label></div><p class="section-label">Alertas orientativas por prioridad (minutos)</p><div class="two"><label>Crítica<input name="criticalMinutes" type="number" min="1" max="10080" value="'+esc(times.CRITICA)+'"></label><label>Alta<input name="highMinutes" type="number" min="1" max="10080" value="'+esc(times.ALTA)+'"></label><label>Media<input name="mediumMinutes" type="number" min="1" max="10080" value="'+esc(times.MEDIA)+'"></label><label>Baja<input name="lowMinutes" type="number" min="1" max="10080" value="'+esc(times.BAJA)+'"></label></div><div class="two"><label>Casos por página histórica<input name="historyPageSize" type="number" min="25" max="200" value="'+esc(value.historyPageSize||100)+'"></label><label>Retención mínima (años)<input name="retentionYears" type="number" min="5" max="20" value="'+esc(value.retentionYears||5)+'"></label></div><label class="check"><input name="notificationsEnabled" type="checkbox" '+(value.notificationsEnabled!==false?'checked':'')+'>Notificaciones nativas en Drive cuando el permiso ya fue concedido</label><label>Texto adicional de guía Central<textarea name="centralGuide" maxlength="4000">'+esc(value.centralGuide||'')+'</textarea></label><label>Texto adicional de guía Drive<textarea name="driverGuide" maxlength="4000">'+esc(value.driverGuide||'')+'</textarea></label><p class="info">Los tiempos solo orientan alertas visuales; no son un SLA. Seguridad: PIN con hash y salt, sesiones de 30 minutos, adjuntos privados y acceso por conductor. Diagnóstico: la unidad real de Geotab se comprueba antes de convertir a G.</p><button class="primary">Guardar operación</button></form>';
          this.$('settings-form').onsubmit=event=>{event.preventDefault();const fd=new FormData(event.currentTarget),next={vehicleGroups:String(fd.get('vehicleGroups')).split(',').map(x=>x.trim()).filter(Boolean),driverGroups:String(fd.get('driverGroups')).split(',').map(x=>x.trim()).filter(Boolean),pollMs:Number(fd.get('pollMs')),maxAttachmentBytes:Number(fd.get('maxAttachmentBytes')),historyPageSize:Number(fd.get('historyPageSize')),retentionYears:Number(fd.get('retentionYears')),priorityMinutes:{CRITICA:Number(fd.get('criticalMinutes')),ALTA:Number(fd.get('highMinutes')),MEDIA:Number(fd.get('mediumMinutes')),BAJA:Number(fd.get('lowMinutes'))},notificationsEnabled:fd.has('notificationsEnabled'),centralGuide:fd.get('centralGuide'),driverGuide:fd.get('driverGuide')};this.run(event.submitter,async()=>{await this.service.saveConfig('settings',next);await this.adminContent();await this.refresh();this.toast('Configuración operativa guardada');});};return;
        }
        const items=data[type]||[];
        this.$('admin-editor').innerHTML='<div class="list-choice">'+items.map((item,i)=>'<button data-edit="'+i+'">'+esc(item.name)+'<small>'+esc(type==='personnel'?item.area:item.kind)+' · '+(item.active?'Activo':'Inactivo')+'</small></button>').join('')+'</div><button id="a-new-config" style="margin:12px 0">Agregar '+(type==='personnel'?'personal':'regla')+'</button><div id="a-config-form"></div>';
        const edit=item=>{this.$('config-form').innerHTML='<form id="a-save-config" class="form-stack"><label>Nombre<input name="name" required value="'+esc(item.name)+'"></label>'+(type==='personnel'?'<label>Área<input name="area" required value="'+esc(item.area)+'"></label><label class="check"><input name="canManage" type="checkbox" '+(item.canManage!==false?'checked':'')+'>Puede gestionar casos</label>':'<label>Regla de Geotab<input name="geotabRuleId" value="'+esc(item.geotabRuleId)+'"></label><div class="two"><label>Medición<select name="kind">'+options(['stop','speed','acceleration','braking','cornering'],item.kind)+'</select></label><label>Unidad de origen<select name="sourceUnit">'+options(['s','km/h','G','m/s2'],item.sourceUnit)+'</select></label></div><label>Prioridad<select name="priority">'+options(D.PRIORITIES,item.priority)+'</select></label><label class="check"><input name="show" type="checkbox" '+(item.show!==false?'checked':'')+'>Mostrar en Central</label><label class="check"><input name="allowSend" type="checkbox" '+(item.allowSend!==false?'checked':'')+'>Permitir envío al conductor</label>')+'<label class="check"><input name="active" type="checkbox" '+(item.active?'checked':'')+'>Activo</label><button class="primary">Guardar</button></form>';this.$('save-config').onsubmit=event=>{event.preventDefault();const fd=new FormData(event.currentTarget),value={...item,...Object.fromEntries(fd),id:item.id||S.uid(),active:fd.has('active')};if(type==='personnel')value.canManage=fd.has('canManage');else{value.show=fd.has('show');value.allowSend=fd.has('allowSend');}this.run(event.submitter,async()=>{await this.service.saveConfig(type,value);await this.adminContent();await this.refresh();this.toast('Configuración guardada');});};};
        this.$('admin-editor').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(items[Number(b.dataset.edit)]));this.$('new-config').onclick=()=>edit({active:true,priority:'MEDIA',kind:'stop',sourceUnit:'s'});
      };
      this.$('dialog-body').querySelectorAll('[data-admin]').forEach(b=>b.onclick=()=>{this.$('dialog-body').querySelectorAll('[data-admin]').forEach(x=>x.classList.toggle('active',x===b));render(b.dataset.admin);});render('personnel');
    }
  }
  window.ArdepeUI=ArdepeUI;
})();

