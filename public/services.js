(function () {
  'use strict';
  const D = window.ArdepeDomain;
  const uid = () => crypto.randomUUID();
  const clone = value => JSON.parse(JSON.stringify(value));
  const defaults = {
    personnel: [{ id: 'demo-operator', name: 'José Pérez', area: 'Monitoreo', active: true, canManage: true }],
    rules: [
      { id: 'stop', name: 'Parada no autorizada', geotabRuleId: 'a5fDeSx0O8UGtIJ-blG7Wxw', kind: 'stop', sourceUnit: 's', priority: 'ALTA', active: true, show: true, allowSend: true },
      { id: 'speed', name: 'Exceso de velocidad', geotabRuleId: '', kind: 'speed', sourceUnit: 'km/h', priority: 'ALTA', active: false, show: true, allowSend: true },
      { id: 'braking', name: 'Frenada brusca', geotabRuleId: '', kind: 'braking', sourceUnit: 'G', priority: 'ALTA', active: false, show: true, allowSend: true }
    ],
    drivers: [{ id: 'demo-driver', name: 'Carlos Ramírez' }, { id: 'demo-driver-2', name: 'Luis Mendoza' }],
    settings: { vehicleGroups:['b2798','b279A'],driverGroups:['b3271'],pollMs:15000,notificationsEnabled:true,maxAttachmentBytes:3000000,historyPageSize:100,retentionYears:5,priorityMinutes:{CRITICA:15,ALTA:30,MEDIA:60,BAJA:120},centralGuide:'',driverGuide:'' }
  };
  function demoEvents() {
    const today = new Date(D.preset('today').from).getTime(), t = offset => new Date(today + offset * 60000).toISOString();
    return [
      { id: 'demo-event-1', title: 'Parada no autorizada', plate: 'CDK-772', priority: 'ALTA', occurredAt: t(400), activeTo: t(407), driverId: 'demo-driver', driverName: 'Carlos Ramírez', location: 'Av. Néstor Gambetta · Callao', latitude: -11.984, longitude: -77.126, measurement: D.measurement('stop', '00:07:00', 's', t(400), t(407)) },
      { id: 'demo-event-2', title: 'Exceso de velocidad', plate: 'BHV-918', priority: 'CRITICA', occurredAt: t(390), activeTo: t(391), driverId: 'demo-driver-2', driverName: 'Luis Mendoza', location: 'Panamericana Norte · Puente Piedra', latitude: -11.86, longitude: -77.07, measurement: D.measurement('speed', 92, 'km/h') },
      { id: 'demo-event-3', title: 'Frenada brusca', plate: 'CDK-772', priority: 'MEDIA', occurredAt: t(380), activeTo: t(381), driverId: 'demo-driver', driverName: 'Carlos Ramírez', location: 'Ventanilla · Callao', latitude: -11.88, longitude: -77.13, measurement: D.measurement('braking', -0.45, 'G') }
    ].map(item => ({ ...item, eventKey: D.eventKey('ARDEPE', item.id), ruleId: ['stop','speed','braking'][Number(item.id.slice(-1))-1], origin: 'GEOTAB', status: 'NUEVO', description: item.title, deviceId: item.plate, version: 0 }));
  }
  class DemoService {
    constructor(role) { this.role = role; this.actor = role === 'driver' ? { role, id: 'demo-driver', name: 'Carlos Ramírez' } : { role: 'central', id: 'demo-user', name: 'Operador de demostración' }; }
    read() {
      try { const value = JSON.parse(localStorage.getItem('ardepe-demo-v2')); if (value && value.cases && value.config) {
        value.config.settings=value.config.settings||clone(defaults.settings);
        Object.values(value.cases).forEach(item=>{if(item.eventKeys&&item.eventKeys.length&&(!item.events||!item.events.length))item.events=item.eventKeys.map(key=>({key,occurredAt:item.occurredAt,title:item.title,measurement:item.measurement,ruleId:item.measurement&&item.measurement.kind||''}));});
        return value;
      } } catch (_) {}
      return { cases: {}, operations: {}, config: clone(defaults) };
    }
    async bootstrap() { const data = this.read(); return { ...data.config, cases: Object.values(data.cases).filter(item => D.actorCanRead(this.actor, item)), events: this.role === 'central' ? demoEvents() : [], actor: this.actor }; }
    async detail(id) { const item = this.read().cases[id]; if (!item || !D.actorCanRead(this.actor, item)) throw new Error('Caso no disponible'); return clone(item); }
    async command(command, personId) {
      // Web Locks serializes changes across the two demo tabs when the browser supports it.
      const write = async () => {
        const data = this.read();
        if (data.operations[command.operationId]) return clone(data.operations[command.operationId]);
        const actor = { ...this.actor, person: data.config.personnel.find(p => p.id === personId) };
        const key = command.payload && command.payload.eventKey ? D.eventRef(command.payload).key : '';
        const current=data.cases[command.caseId];
        if(command.type==='message' && actor.role==='central' && current && current.eventKeys.length && (current.events||[]).some(e=>{const rule=data.config.rules.find(r=>r.id===e.ruleId);return !rule || !rule.active || rule.allowSend!==true;})) throw new Error('La regla no permite enviar mensajes al conductor');
        if (key && ['create', 'associate'].includes(command.type)) {
          const found = Object.values(data.cases).find(c => c.eventKeys.includes(key));
          if (found && found.id !== command.caseId) throw new Error('Este evento ya tiene una atención. Consulte el historial.');
        }
        const result = D.apply(data.cases[command.caseId], command, actor, new Date().toISOString());
        data.cases[result.id] = result; data.operations[command.operationId] = result;
        localStorage.setItem('ardepe-demo-v2', JSON.stringify(data)); return clone(result);
      };
      return navigator.locks ? navigator.locks.request('ardepe-demo-write', write) : write();
    }
    async drivers() { return clone(this.read().config.drivers); }
    // Marca liviana: en demo no hay ahorro real (todo es local), pero se implementa igual para que
    // la interfaz use el mismo camino que en producción, sin distinguir el modo.
    async marker() { const cases = Object.values(this.read().cases).filter(item => D.actorCanRead(this.actor, item)); return cases.reduce((m,c) => (c.updatedAt||'') > m ? c.updatedAt : m, ''); }
    async devices() { return [{ id: 'CDK-772', name: 'CDK-772' }, { id: 'BHV-918', name: 'BHV-918' }]; }
    async mobileContext() { return { deviceId:'CDK-772', plate:'CDK-772', location:'Ubicación simulada de Geotab Drive', latitude:-11.984, longitude:-77.126 }; }
    async history(from, to) { D.range(from, to, 366); return {cases:(await this.bootstrap()).cases.filter(c => c.occurredAt >= from && c.occurredAt <= to),nextPageToken:''}; }
    async explore(from, to, rule) { D.range(from, to); if (!rule) throw new Error('Seleccione una regla'); const data = await this.bootstrap(); return data.events.filter(e => e.occurredAt >= from && e.occurredAt <= to && e.measurement.kind === rule && !data.cases.some(c => c.eventKeys.includes(e.eventKey))); }
    async evidence(file) { return file.dataUrl; }
    async adminLogin() { return { demo: true }; }
    async adminData() { return clone(this.read().config); }
    async saveConfig(type, value) {
      const data = this.read(); const items = data.config[type];
      if(type==='settings'){data.config.settings=value;localStorage.setItem('ardepe-demo-v2',JSON.stringify(data));return value;}
      const index = items.findIndex(x => x.id === value.id); if (index < 0) items.push(value); else items[index] = value;
      localStorage.setItem('ardepe-demo-v2', JSON.stringify(data)); return value;
    }
  }
  class LiveService {
    constructor(api, role) { this.api = api; this.role = role; this.token = ''; this.adminToken = ''; this.eventCache = new Map(); this.diagnosticCache = new Map(); this.running = false; this.reconnecting = null; }
    geotabCall(method, params) {
      return new Promise((resolve,reject)=>{
        let settled=false;
        const done=value=>{if(!settled){settled=true;resolve(value);}};
        const fail=error=>{if(!settled){settled=true;reject(error instanceof Error?error:new Error(String(error&&error.message||error||'Error de Geotab')));}};
        try{
          const result=this.api.call(method,params,done,fail);
          if(result&&typeof result.then==='function')result.then(done,fail);
          else if(result!==undefined)done(result);
        }catch(error){fail(error);}
      });
    }
    sessionExpired(error) { return /Sesión vencida|Session expired/i.test(String(error&&error.message||error||'')); }
    async renewSession() {
      if (!this.reconnecting) this.reconnecting = this.connect().finally(() => { this.reconnecting = null; });
      return this.reconnecting;
    }
    async request(params, post = false, retried = false, onProgress) {
      const tokenAtStart=this.token;
      try { return await this.rawRequest(params,post,onProgress); }
      catch(error) {
        if(!retried&&params.action!=='v2.login'&&this.sessionExpired(error)){
          if(this.token===tokenAtStart)await this.renewSession();
          return this.request(params,post,true,onProgress);
        }
        throw error;
      }
    }
    async rawRequest(params, post = false, onProgress) {
      if (!window.ARDEPE_CONFIG.backendUrl) throw new Error('El backend definitivo aún no está configurado. Esta pantalla no ha enviado datos.');
      const url = new URL(window.ARDEPE_CONFIG.backendUrl);
      const values = { ...params, token: Object.hasOwn(params,'_token')?params._token:this.token, apiVersion: '2' };delete values._token;
      if (post) {
        // El envío usa 'no-cors': el navegador nunca puede leer si el servidor lo aceptó o no.
        // Por eso el único modo confiable de saberlo es preguntar después ("Confirmando…"). Un fallo
        // al enviar (conexión lenta, tiempo agotado) no significa que no haya llegado: se sigue
        // igual a comprobarlo, en silencio, en vez de mostrar un error de una vez.
        const send = async () => {
          try { if(onProgress)onProgress('Enviando…'); await fetch(url, { method: 'POST', mode: 'no-cors', body: new URLSearchParams(values), signal: AbortSignal.timeout(30000) }); }
          catch (_) { /* no es definitivo: se confirma preguntando, no por esta respuesta */ }
        };
        await send();
        if(onProgress)onProgress('Confirmando…');
        // Hasta unos 3 minutos de espera silenciosa: cubre una conexión lenta o una caída corta sin
        // mostrar ningún error, siempre con el mismo número de operación, así que nunca se duplica.
        // Pasados ~20 s sin noticia, el aviso cambia para que no se sienta como que la pantalla murió,
        // aunque el sistema siga intentando igual por dentro. Se reenvía a los ~15 s y a los ~90 s,
        // por si el primer envío nunca llegó a salir del navegador.
        const resendAt = new Set([24, 155]);
        let warned = false;
        for (let attempt = 0; attempt < 305; attempt++) {
          await new Promise(resolve => setTimeout(resolve, attempt<8?250:600));
          if (!warned && attempt === 40) { warned = true; if (onProgress) onProgress('Esto está tardando más de lo normal, seguimos intentando…'); }
          if (resendAt.has(attempt)) await send();
          let status;
          try {
            status = params.action==='v2.login'
              ? await this.rawRequest({ action: 'v2.operation', operationId: params.operationId, receipt: params.receipt, _token:'' })
              : await this.request({ action: 'v2.operation', operationId: params.operationId, receipt: params.receipt });
          } catch (error) { if (error.definitive) throw error; continue; }
          if (!status.pending) { if (!status.success) { const error=new Error(status.message); error.definitive=true; throw error; } return status.result; }
        }
        const error = new Error('El servidor aún no confirmó la operación. Reintente conservando los datos; se usará la misma operación.'); error.uncertain = true; throw error;
      }
      Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, value));
      // Las consultas (leer, no escribir) son seguras de repetir: si una falla por una conexión
      // lenta puntual, se reintenta un par de veces antes de mostrar cualquier error.
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
          if (!response.ok) throw new Error('Error de conexión (' + response.status + ')');
          const result = await response.json(); if (!result.success) { const error=new Error(result.message || 'Operación rechazada');error.definitive=true;throw error; } return result;
        } catch (error) {
          lastError = error;
          if (error.definitive) throw error;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      throw lastError;
    }
    async connect() {
      let driver;
      if (this.role === 'driver') {
        if (!this.api.mobile || !this.api.mobile.user) throw new Error('Abra este módulo desde Geotab Drive');
        const users = await this.api.mobile.user.get();
        driver = (Array.isArray(users) ? users : [users]).find(u => u && u.id && !['NoDriverId', 'UnknownDriverId'].includes(u.id));
        if (!driver) throw new Error('No se encontró un conductor conectado');
      }
      const session = await new Promise((resolve, reject) => {
        try { const result = this.api.getSession(resolve); if (result && result.then) result.then(resolve, reject); } catch (error) { reject(error); }
      });
      const auth = await this.request({ action: 'v2.login', operationId: uid(), receipt: uid(), credentials: JSON.stringify(session), role: this.role, driverId: driver ? driver.id : '' }, true);
      this.token = auth.token; this.actor = auth.actor;
    }
    async bootstrap() {
      const response = await this.request({ action: 'v2.bootstrap' });
      this.rules = response.rules || []; this.settings = response.settings || {};
      return { ...response, actor: this.actor, events: this.role === 'central' ? await this.queryEvents(D.preset('today').from, new Date().toISOString()) : [] };
    }
    async detail(id) { return (await this.request({ action: 'v2.case', caseId: id })).case; }
    pendingKey() { return 'ardepe-pending-v2:' + window.ARDEPE_CONFIG.backendUrl + ':' + this.actor.id + ':' + this.role; }
    pendingDb() {
      if(!window.indexedDB)return Promise.resolve(null);
      return new Promise((resolve,reject)=>{const request=indexedDB.open('ardepe-central-v2',1);request.onupgradeneeded=()=>request.result.createObjectStore('pending');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    }
    async pendingCommand() {
      try{const db=await this.pendingDb();if(db)return await new Promise((resolve,reject)=>{const request=db.transaction('pending','readonly').objectStore('pending').get(this.pendingKey());request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});}catch(_){}
      try{return JSON.parse(sessionStorage.getItem(this.pendingKey())||'null');}catch(_){return null;}
    }
    async savePending(value) {
      try{const db=await this.pendingDb();if(db){await new Promise((resolve,reject)=>{const transaction=db.transaction('pending','readwrite');transaction.objectStore('pending').put(value,this.pendingKey());transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});return;}}catch(_){}
      try{sessionStorage.setItem(this.pendingKey(),JSON.stringify(value));}catch(_){throw new Error('No hay espacio local para conservar el envío. No se enviaron datos; reduzca los adjuntos o libere almacenamiento.');}
    }
    async clearPending() {
      try{const db=await this.pendingDb();if(db)await new Promise((resolve,reject)=>{const transaction=db.transaction('pending','readwrite');transaction.objectStore('pending').delete(this.pendingKey());transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});}catch(_){}
      sessionStorage.removeItem(this.pendingKey());
    }
    async recoverPending() {
      const pending=await this.pendingCommand();
      if(!pending)throw new Error('No hay envíos pendientes de confirmación en esta pestaña');
      return this.command(pending.command,pending.personId);
    }
    async command(command, personId, onProgress) {
      const pending=await this.pendingCommand();
      if(pending && pending.command.operationId!==command.operationId){
        // Antes de avisar nada, se intenta confirmar solo el envío anterior, en silencio (el mismo
        // mecanismo de "Reintentar", pero automático). Solo si eso tampoco logra resolverlo se avisa.
        try{ await this.command(pending.command,pending.personId); }
        catch(_){ const error=new Error('Hay un envío sin confirmar. Pulse Reintentar envío pendiente antes de continuar.');error.uncertain=true;throw error; }
      }
      // Persist before sending. If storage is full, no request is sent; evidence is never silently lost.
      await this.savePending({command,personId});
      try{
        const result=await this.request({ action: 'v2.command', operationId: command.operationId, receipt: command.receipt, command: JSON.stringify(command), personId: personId || '' }, true, false, onProgress);
        await this.clearPending();return result;
      }catch(error){if(!error.definitive)error.uncertain=true;if(!error.uncertain)await this.clearPending();throw error;}
    }
    async devices() {
      if (!this.deviceList) {
        const rows = await this.geotabCall('Get', { typeName: 'Device', search: { activeState: 'Active' } });
        const groups = this.settings.vehicleGroups || window.ARDEPE_CONFIG.vehicleGroups;
        this.deviceList = (Array.isArray(rows)?rows:[]).filter(d => d.serialNumber !== '000-000-0000' && (d.groups || []).some(g => groups.includes(g.id)));
      }
      return this.deviceList;
    }
    async mobileContext() {
      if(this.role!=='driver'||!this.api.mobile) return {};
      const context={};
      try{
        if(this.api.mobile.vehicle&&this.api.mobile.vehicle.get){const vehicle=await this.api.mobile.vehicle.get();if(vehicle){context.deviceId=vehicle.id||vehicle.device&&vehicle.device.id||'';context.plate=vehicle.name||vehicle.device&&vehicle.device.name||'';}}
      }catch(_){}
      try{
        const geo=this.api.mobile.geolocation;
        if(geo&&geo.getCurrentPosition){const position=await new Promise((resolve,reject)=>geo.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:8000,maximumAge:60000}));context.latitude=position.coords.latitude;context.longitude=position.coords.longitude;context.location=context.latitude.toFixed(6)+', '+context.longitude.toFixed(6);}
      }catch(_){}
      return context;
    }
    // Consulta liviana: solo pregunta al servidor su marca en memoria, sin leer ninguna hoja.
    async marker() { return (await this.request({ action: 'v2.marker' })).marker || ''; }
    async drivers() {
      if (!this.driverList) {
        const users = await this.geotabCall('Get', { typeName: 'User' });
        const groups = this.settings.driverGroups || window.ARDEPE_CONFIG.driverGroups;
        this.driverList = (Array.isArray(users)?users:[]).filter(u => [...(u.driverGroups || []), ...(u.companyGroups || [])].some(g => groups.includes(g.id))).map(u => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name }));
      }
      return this.driverList;
    }
    async queryEvents(from, to, ruleId) {
      if (this.running) throw new Error('Hay una consulta de Geotab en curso');
      D.range(from, to); this.running = true;
      try {
        // La clave redondea 'to' a bloques de 30 s: 'to' cambia en cada refresco (siempre es "ahora"),
        // así que sin este redondeo la caché nunca acertaba y se consultaba Geotab en cada ciclo.
        const cacheKey = from + Math.floor(Date.parse(to) / 30000) + (ruleId || 'all'), cached = this.eventCache.get(cacheKey);
        if (cached && Date.now() - cached.at < 30000) return clone(cached.events);
        const devices = new Map((await this.devices()).map(d => [d.id, d]));
        const rules = (this.rules || []).filter(r => r.active && r.show !== false && r.geotabRuleId && (!ruleId || r.id === ruleId));
        const found = new Map();
        const fetchSlice = async (rule, start, end, depth = 0) => {
          const response = await this.geotabCall('Get', { typeName: 'ExceptionEvent', resultsLimit: 1000, search: { ruleSearch: { id: rule.geotabRuleId }, fromDate: start, toDate: end } });
          const rows=Array.isArray(response)?response:[];
          if (rows.length >= 1000) {
            if (depth >= 12 || Date.parse(end) - Date.parse(start) < 1000) throw new Error('Demasiados eventos en el intervalo. Reduzca el rango para obtener una consulta completa.');
            const mid = new Date(Math.floor((Date.parse(start) + Date.parse(end)) / 2)).toISOString();
            await fetchSlice(rule, start, mid, depth + 1); await fetchSlice(rule, mid, end, depth + 1); return;
          }
          for (const raw of rows) {
            if (!raw.id || !raw.device || !devices.has(raw.device.id)) continue;
            const key = D.eventKey(window.ARDEPE_CONFIG.database, raw.id), device = devices.get(raw.device.id);
            found.set(key, { id: key, eventKey: key, title: rule.name, description: rule.name, origin: 'GEOTAB', status: 'NUEVO', priority: rule.priority, occurredAt: raw.activeFrom, activeTo: raw.activeTo || '', plate: device.name, deviceId: device.id, rule, latitude: raw.latitude, longitude: raw.longitude, driverId: '', driverName: '', location: '', version: 0, measurement: D.measurement(rule.kind, rule.kind==='stop'?raw.duration:null, rule.sourceUnit, raw.activeFrom, raw.activeTo || new Date().toISOString()) });
          }
        };
        for (const rule of rules) await fetchSlice(rule, from, to);
        const events = [...found.values()]; this.eventCache.set(cacheKey, { at: Date.now(), events });
        if (this.eventCache.size > 20) this.eventCache.delete(this.eventCache.keys().next().value);
        return events;
      } finally { this.running = false; }
    }
    // Zonas del tipo configurado en window.ARDEPE_CONFIG.zoneTypeId (ver config.js). Se cargan una sola
    // vez por sesión y se guardan en this.zoneList; si Geotab no las entrega, el caso sigue mostrando
    // solo la dirección, sin errores. No se usan en el modo demostración (DemoService no llama a resolve()).
    pointInPolygon(lat, lng, points) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y, xj = points[j].x, yj = points[j].y;
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    async zones() {
      if (this.zoneList) return this.zoneList;
      if (this.zoneFailedAt && Date.now() - this.zoneFailedAt < 300000) return [];
      if (!this.zoneLoading) {
        this.zoneLoading = (async () => {
          try {
            const typeId = window.ARDEPE_CONFIG.zoneTypeId;
            const rows = await this.geotabCall('Get', { typeName: 'Zone' });
            this.zoneList = (Array.isArray(rows) ? rows : []).filter(z => z && z.name && Array.isArray(z.points) && z.points.length >= 3 && (z.zoneTypes || []).some(t => t.id === typeId)).map(z => {
              let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
              for (const p of z.points) { if (p.y < minLat) minLat = p.y; if (p.y > maxLat) maxLat = p.y; if (p.x < minLng) minLng = p.x; if (p.x > maxLng) maxLng = p.x; }
              return { name: z.name, points: z.points, minLat, maxLat, minLng, maxLng };
            });
            this.zoneFailedAt = 0;
          } catch (_) { this.zoneFailedAt = Date.now(); }
          finally { this.zoneLoading = null; }
          return this.zoneList || [];
        })();
      }
      return this.zoneLoading;
    }
    async zoneAt(lat, lng) {
      const zone = (await this.zones()).find(z => lat >= z.minLat && lat <= z.maxLat && lng >= z.minLng && lng <= z.maxLng && this.pointInPolygon(lat, lng, z.points));
      return zone ? zone.name : '';
    }
    async resolve(event) {
      if (!event.rule) return event;
      const start = new Date(Date.parse(event.occurredAt) - 2000).toISOString(), end = new Date(Date.parse(event.activeTo || new Date().toISOString()) + 2000).toISOString();
      const logResponse = await this.geotabCall('Get', { typeName: 'LogRecord', search: { deviceSearch: { id: event.deviceId }, fromDate: start, toDate: end } });
      const logs=Array.isArray(logResponse)?logResponse:[];
      if (event.rule.kind === 'speed') {
        const samples = logs.filter(l => l.speed != null && Number.isFinite(Number(l.speed))).map(l => Number(l.speed));
        event.measurement = D.measurement('speed', samples.length ? Math.max(...samples) : null, 'km/h');
      } else if (['acceleration', 'braking', 'cornering'].includes(event.rule.kind)) {
        const id = event.rule.kind === 'cornering' ? 'DiagnosticAccelerationSideToSideId' : 'DiagnosticAccelerationForwardBrakingId';
        let actualUnit=this.diagnosticCache.get(id);
        if(!actualUnit){
          const definitionResponse=await this.geotabCall('Get',{typeName:'Diagnostic',search:{id}}),definitions=Array.isArray(definitionResponse)?definitionResponse:[],definition=definitions[0];
          if(!definition||!definition.unitOfMeasure||!definition.unitOfMeasure.id)throw new Error('Geotab no informó la unidad del diagnóstico '+id);
          const unitResponse=await this.geotabCall('Get',{typeName:'UnitOfMeasure',search:{id:definition.unitOfMeasure.id}}),units=Array.isArray(unitResponse)?unitResponse:[],unit=units[0]||definition.unitOfMeasure;
          const label=((unit.name||'')+' '+(unit.abbreviation||'')+' '+unit.id).toLowerCase();
          actualUnit=/met.*second|m\/s|acceleration/.test(label)?'m/s2':/(^|\s)g($|\s)|gravity|gravities/.test(label)?'G':'';
          if(!actualUnit)throw new Error('Unidad de diagnóstico no reconocida: '+(unit.name||unit.id));
          this.diagnosticCache.set(id,actualUnit);
        }
        if(event.rule.sourceUnit!==actualUnit)throw new Error('La regla '+event.rule.name+' está configurada en '+event.rule.sourceUnit+' pero Geotab informa '+actualUnit);
        const statusResponse = await this.geotabCall('Get', { typeName: 'StatusData', search: { deviceSearch: { id: event.deviceId }, diagnosticSearch: { id }, fromDate: start, toDate: end } });
        const rows=Array.isArray(statusResponse)?statusResponse:[];
        const samples = rows.filter(r => r.data != null && Number.isFinite(Number(r.data))).map(r => Number(r.data));
        let peak = null;
        if (samples.length) peak = event.rule.kind === 'braking' ? Math.min(...samples) : event.rule.kind === 'acceleration' ? Math.max(...samples) : Math.max(...samples.map(Math.abs));
        event.measurement = D.measurement(event.rule.kind, peak, actualUnit);
      }
      // Posición: primero la del propio evento (si Geotab ya la trae); si no, la del registro del vehículo.
      let lat = Number(event.latitude), lng = Number(event.longitude);
      if (!(Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0))) {
        const point = logs.find(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
        lat = point ? point.latitude : NaN; lng = point ? point.longitude : NaN;
      }
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        event.latitude = lat; event.longitude = lng;
        let address = lat + ', ' + lng;
        try {
          const addressResponse = await this.geotabCall('GetAddresses', { coordinates: [{ x: lng, y: lat }] });
          const addresses=Array.isArray(addressResponse)?addressResponse:[];
          address = addresses[0] && addresses[0].formattedAddress || address;
        } catch (_) {}
        let zone = '';
        try { zone = await this.zoneAt(lat, lng); } catch (_) {}
        event.location = zone ? 'Zona: ' + zone.toUpperCase() + ' · ' + address : address;
      }
      const changeResponse = await this.geotabCall('Get', { typeName: 'DriverChange', search: { deviceSearch: { id: event.deviceId }, fromDate: event.occurredAt, toDate: event.activeTo || new Date().toISOString(), includeOverlappedChanges: true } });
      const changes=Array.isArray(changeResponse)?changeResponse:[];
      const change = changes.filter(c => c.dateTime <= event.occurredAt).sort((a, b) => a.dateTime.localeCompare(b.dateTime)).pop();
      if (change && change.driver) {
        const driver = (await this.drivers()).find(d => d.id === change.driver.id);
        if (driver) { event.driverId = driver.id; event.driverName = driver.name; }
      }
      return event;
    }
    async history(from, to, pageToken='') { D.range(from, to, 366); return this.request({ action: 'v2.history', from, to, pageToken }); }
    async explore(from, to, rule) {
      if (!rule) throw new Error('Seleccione una regla'); const events = await this.queryEvents(from, to, rule);
      const result = await this.request({ action: 'v2.associations', from, to });
      return events.filter(e => !result.eventKeys.includes(e.eventKey));
    }
    async evidence(file) { return (await this.request({ action: 'v2.evidence', caseId: file.caseId, fileId: file.fileId })).dataUrl; }
    async adminLogin(pin) { const response = await this.request({ action: 'v2.adminLogin', pin, operationId: uid(), receipt: uid() }, true); this.adminToken = response.adminToken; return response; }
    async adminData() { return this.request({ action: 'v2.adminData', adminToken: this.adminToken }); }
    async saveConfig(type, value) { return this.request({ action: 'v2.saveConfig', adminToken: this.adminToken, type, value: JSON.stringify(value), operationId: uid(), receipt: uid() }, true); }
    async notify(title,message,key='') {
      const notification=this.api&&this.api.mobile&&this.api.mobile.notification;
      if(this.role!=='driver'||!notification||!notification.notify||this.settings&&this.settings.notificationsEnabled===false)return false;
      const storageKey='ardepe-notified-v2:'+this.actor.id;if(key&&sessionStorage.getItem(storageKey)===key)return false;
      try{
        if(notification.hasPermission&&!await notification.hasPermission()&&notification.requestPermission)await notification.requestPermission();
        await notification.notify(message,title);
        if(key)sessionStorage.setItem(storageKey,key);return true;
      }catch(_){return false;}
    }
  }
  window.ArdepeServices = { DemoService, LiveService, defaults, uid };
})();
