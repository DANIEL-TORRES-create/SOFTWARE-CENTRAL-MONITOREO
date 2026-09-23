/* Shared by Central, Drive, Apps Script and Node tests. No browser dependencies. */
(function (root, factory) {
  const domain = factory();
  if (typeof module === 'object' && module.exports) module.exports = domain;
  else root.ArdepeDomain = domain;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STATES = Object.freeze({
    NUEVO: 'Por gestionar', EN_GESTION: 'En gestión', ESPERANDO_CONDUCTOR: 'Esperando respuesta conductor',
    RESPUESTA_RECIBIDA: 'Respuesta recibida', ESPERANDO_ACLARACION: 'Esperando aclaración',
    EN_SEGUIMIENTO: 'En seguimiento', CAPACITACION_PENDIENTE: 'Capacitación pendiente',
    REVISION_TECNICA_PENDIENTE: 'Revisión técnica pendiente', ESCALADO: 'Escalado', FINALIZADA: 'Atención finalizada'
  });
  const RESULTS = ['Evento confirmado', 'Evento justificado', 'Falsa alerta', 'Solo informativo', 'No amerita descargo', 'Atención telefónica suficiente', 'Sin elementos para continuar', 'Derivado a otra área'];
  const TYPES = ['Accidente', 'Incidente', 'Falla vehículo', 'Condición peligrosa vía', 'Emergencia operativa', 'Otro'];
  const CAUSES = ['Conducta insegura', 'Condición de la vía', 'Emergencia operativa', 'Falla del vehículo', 'Tránsito', 'Instrucción operativa', 'No determinada'];
  const ACTIONS = ['Recomendación', 'Capacitación', 'Revisión técnica', 'Comunicar supervisor', 'Escalar jefatura', 'Seguimiento operaciones', 'No requiere'];
  // "Drive" remains accepted so historical ledger rows can always be replayed.
  const CHANNELS = ['Geotab Drive', 'Drive', 'Teléfono', 'Supervisor', 'Otro', 'Sin respuesta', 'No aplica'];
  const PRIORITIES = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];
  const FOLLOW_STATES = ['EN_SEGUIMIENTO', 'CAPACITACION_PENDIENTE', 'REVISION_TECNICA_PENDIENTE', 'ESCALADO'];
  const FILE_TYPES = {
    'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'],
    'application/pdf': ['pdf'], 'text/plain': ['txt'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx']
  };
  function required(value, label, max = 6000) {
    const text = String(value == null ? '' : value).trim();
    if (!text) throw new Error(label + ' es obligatorio');
    if (text.length > max) throw new Error(label + ': máximo ' + max + ' caracteres');
    return text;
  }
  function seconds(from, to) {
    const a = Date.parse(from), b = Date.parse(to);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((b - a) / 1000)) : 0;
  }
  function elapsed(value) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(v => String(v).padStart(2, '0')).join(':');
  }
  function limaDay(value) { return new Date(new Date(value).getTime() - 18000000).toISOString().slice(0, 10); }
  function month(value) { return limaDay(value).slice(0, 7).replace('-', '_'); }
  function preset(key, now = new Date().toISOString()) {
    const day = limaDay(now), midnight = new Date(day + 'T00:00:00-05:00').getTime();
    if (key === 'today') return { from: new Date(midnight).toISOString(), to: new Date(now).toISOString() };
    const end = midnight - 1, start = midnight - (key === '7days' ? 7 : 1) * 86400000;
    return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
  }
  function range(from, to, maxDays = 7) {
    const a = Date.parse(from), b = Date.parse(to);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) throw new Error('Rango de fechas inválido');
    if (b - a >= maxDays * 86400000) throw new Error('Consulte hasta ' + maxDays + ' días por vez');
    return { from: new Date(a).toISOString(), to: new Date(b).toISOString() };
  }
  function eventKey(database, id) { return required(database, 'Base', 100).replace(/\s/g, '').toLowerCase() + ':' + required(id, 'Evento', 100).replace(/\s/g, ''); }
  function eventRef(payload) {
    const parts = required(payload.eventKey, 'Evento', 201).split(':');
    if (parts.length !== 2) throw new Error('Identidad del evento inválida');
    if (!Number.isFinite(Date.parse(payload.occurredAt))) throw new Error('Fecha del evento inválida');
    return { key: eventKey(parts[0], parts[1]), occurredAt: new Date(payload.occurredAt).toISOString(),
      title: required(payload.title || 'Evento Geotab', 'Evento', 200), ruleId: String(payload.ruleId || payload.rule && payload.rule.id || ''),
      measurement: payload.measurement || null };
  }
  function number(value) { return value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null; }
  function measurement(kind, raw, sourceUnit, from, to) {
    let value = null, unit = '', text = 'Valor no disponible';
    if (kind === 'stop') {
      unit = 's';
      if (Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to)) && Date.parse(to) >= Date.parse(from)) value = seconds(from, to);
      else {
        const legacy = String(raw || '').match(/^(?:1899-12-(?:30|31)T)?(\d+):(\d{2}):(\d{2})(?:\.\d+)?Z?$/);
        if (legacy) value = Number(legacy[1]) * 3600 + Number(legacy[2]) * 60 + Number(legacy[3]);
        else if (sourceUnit === 's') value = number(raw);
      }
      if (value !== null && value >= 0) text = elapsed(value); else value = null;
    } else if (kind === 'speed') {
      unit = 'km/h'; value = number(raw);
      if (value !== null && sourceUnit === 'm/s') value *= 3.6;
      else if (sourceUnit !== 'km/h') value = null;
      if (value !== null && value >= 0) text = Math.round(value) + ' km/h'; else value = null;
    } else if (['acceleration', 'braking', 'cornering'].includes(kind)) {
      unit = 'G'; value = number(raw);
      if (value !== null && ['m/s²', 'm/s2'].includes(sourceUnit)) value /= 9.80665;
      else if (!['G', 'g'].includes(sourceUnit)) value = null;
      if (value !== null) { value = Math.abs(value); text = value.toFixed(2) + ' G'; }
    }
    return { kind, original: raw == null ? null : raw, sourceUnit: sourceUnit || '', value, unit, text };
  }
  function validateAttachment(file, maxBytes = 3000000) {
    const allowed = FILE_TYPES[file.mimeType], ext = String(file.name || '').split('.').pop().toLowerCase();
    if (!allowed || !allowed.includes(ext)) throw new Error('Adjunto no permitido. Use imagen, PDF, TXT, DOCX o XLSX; no video.');
    if (!Number.isInteger(file.size) || file.size <= 0 || file.size > maxBytes) throw new Error('Cada adjunto debe tener entre 1 byte y ' + Math.floor(maxBytes / 1000000) + ' MB');
    return true;
  }
  // Un conductor puede ver (o actuar sobre) un caso propio solo si él mismo lo reportó, o si Central
  // ya le mandó al menos un mensaje real. Así, "Iniciar atención" o "Cambiar conductor" por sí solos
  // nunca hacen que le aparezca algo nuevo — recién cuando Central decide avisarle de verdad.
  function actorCanRead(actor, item) { return actor.role === 'central' || actor.role === 'driver' && actor.id === item.driverId && (item.origin === 'CONDUCTOR' || Boolean(item.lastCentralMessageAt)); }
  function central(actor) {
    if (actor.role !== 'central' || !actor.person || !actor.person.active || actor.person.canManage === false) throw new Error('Seleccione personal activo con permiso de gestión');
  }
  function apply(current, command, actor, now) {
    required(command.operationId, 'Operación', 100);
    const payload = command.payload || {}, type = command.type;
    if (payload.attachments && (!Array.isArray(payload.attachments) || payload.attachments.length && !['message','create'].includes(type))) throw new Error('Adjunte la evidencia a un mensaje');
    if (!Number.isFinite(Date.parse(now))) throw new Error('Fecha de servidor inválida');
    const data = current ? JSON.parse(JSON.stringify(current)) : null;
    if (!data) {
      if (type !== 'create') throw new Error('Caso no encontrado');
      if (actor.role === 'central') central(actor);
      else if (actor.role !== 'driver') throw new Error('Sesión inválida');
      if (!PRIORITIES.includes(payload.priority)) throw new Error('Prioridad inválida');
      if (!Number.isFinite(Date.parse(payload.occurredAt)) || Date.parse(payload.occurredAt) > Date.parse(now) + 300000) throw new Error('Fecha del caso inválida');
      const origin = actor.role === 'driver' ? 'CONDUCTOR' : payload.eventKey ? 'GEOTAB' : 'CENTRAL';
      if (origin !== 'GEOTAB' && !TYPES.includes(payload.type)) throw new Error('Tipo de caso inválido');
      if (actor.role === 'driver' && payload.eventKey) throw new Error('Solo Central puede asociar eventos Geotab');
      const event = payload.eventKey ? eventRef(payload) : null;
      const created = {
        id: command.caseId, version: 1, origin, eventKeys: event ? [event.key] : [], events: event ? [event] : [],
        title: required(payload.title || payload.type, 'Motivo', 200), type: payload.type || 'Evento Geotab',
        priority: payload.priority, occurredAt: new Date(payload.occurredAt).toISOString(), createdAt: now, updatedAt: now,
        status: actor.role === 'driver' ? 'NUEVO' : 'EN_GESTION',
        startedAt: actor.role === 'central' ? now : '', finalizedAt: '',
        driverId: actor.role === 'driver' ? actor.id : payload.driverId || '',
        driverName: actor.role === 'driver' ? actor.name : payload.driverName || '',
        deviceId: payload.deviceId || '', plate: payload.plate || '', location: payload.location || '',
        latitude: number(payload.latitude), longitude: number(payload.longitude),
        measurement: payload.measurement || null, description: required(payload.description, 'Descripción'),
        damages: String(payload.damages || ''), affected: String(payload.affected || ''),
        operator: actor.role === 'central' ? actor.person : null, result: '',
        waitingSeconds: 0, waitingSince: '', firstResponseAt: '', followUpSince: '', followUpSeconds: 0,
        lastCentralMessageAt: '', lastDriverMessageAt: '', readByDriverAt: '', readByCentralAt: '',
        messages: [], managements: [], attachments: [], audit: [{ type: 'create', actor: actor.name, at: now }],
        transitions: [{ from: '', to: actor.role === 'driver' ? 'NUEVO' : 'EN_GESTION', at: now }]
      };
      const initialText=String(payload.initialMessage||'').trim();
      if(initialText || payload.attachments && payload.attachments.length){
        const messageId=command.operationId+':initial';
        const message={id:messageId,authorId:actor.role==='driver'?actor.id:actor.person.id,author:actor.role==='driver'?actor.name:actor.person.name,role:actor.role,text:required(initialText||'Evidencia inicial del caso','Mensaje'),at:now,requiresResponse:actor.role==='central'&&Boolean(payload.requiresResponse)};
        created.messages.push(message);
        if(actor.role==='driver'){created.lastDriverMessageAt=now;created.firstResponseAt=now;}
        else{created.lastCentralMessageAt=now;if(message.requiresResponse){created.status='ESPERANDO_CONDUCTOR';created.transitions.push({from:'EN_GESTION',to:'ESPERANDO_CONDUCTOR',at:now});created.waitingSince=now;}}
        (payload.attachments||[]).forEach(file=>{validateAttachment(file);created.attachments.push({...file,messageId,caseId:created.id,driverId:created.driverId,at:now});});
      }
      return created;
    }
    if (!actorCanRead(actor, data)) throw new Error('Caso no disponible para este conductor');
    if (command.version !== data.version) throw new Error('El caso cambió. Actualice antes de volver a guardar.');
    if (type !== 'read' && data.status === 'FINALIZADA') throw new Error('La atención ya finalizó');
    const previous = data.status;
    if (actor.role === 'central' && type !== 'read') central(actor);
    if (type === 'take') {
      central(actor);
      if (data.operator && data.operator.id !== actor.person.id) throw new Error('Otro operador está atendiendo el caso');
      data.operator = actor.person; data.startedAt = data.startedAt || now; data.status = 'EN_GESTION';
    } else if (type === 'message') {
      if (actor.role === 'central' && (!data.operator || data.operator.id !== actor.person.id)) throw new Error('Inicie la atención con el operador asignado');
      const message = { id: command.operationId, authorId: actor.role === 'driver' ? actor.id : actor.person.id,
        author: actor.role === 'driver' ? actor.name : actor.person.name, role: actor.role,
        text: required(payload.text, 'Mensaje'), at: now, requiresResponse: actor.role === 'central' && Boolean(payload.requiresResponse), confirmationOnly: Boolean(payload.confirmationOnly) };
      data.messages.push(message);
      if (actor.role === 'driver') { data.status = 'RESPUESTA_RECIBIDA'; data.lastDriverMessageAt = now; data.firstResponseAt = data.firstResponseAt || now; }
      else { data.lastCentralMessageAt = now; if (message.requiresResponse) data.status = payload.clarification ? 'ESPERANDO_ACLARACION' : 'ESPERANDO_CONDUCTOR'; }
    } else if (type === 'manage') {
      central(actor);
      if (!data.operator || data.operator.id !== actor.person.id) throw new Error('El caso está asignado a otro operador');
      if (!RESULTS.includes(payload.result)) throw new Error('Complete resultado, causa, canal y acción');
      // "Falsa alerta" y "Solo informativo" no describen una investigación: no exigen causa, canal,
      // tipo de acción, ni el detalle de qué se hizo o un resumen, para poder cerrar el caso directo.
      const informative = ['Falsa alerta', 'Solo informativo'].includes(payload.result);
      if (!informative) {
        if (!CAUSES.includes(payload.cause) || !CHANNELS.includes(payload.channel) || !ACTIONS.includes(payload.action)) throw new Error('Complete resultado, causa, canal y acción');
        required(payload.immediateAction, 'Acción realizada');
      }
      const next = payload.status;
      if (!['EN_GESTION', 'FINALIZADA'].concat(FOLLOW_STATES).includes(next)) throw new Error('Estado de gestión inválido');
      if (!informative) required(payload.summary, 'Resumen y observaciones');
      if (FOLLOW_STATES.includes(next)) { required(payload.owner, 'Responsable de seguimiento'); if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate || '')) throw new Error('Fecha límite de seguimiento obligatoria'); }
      data.managements.push({ ...payload, id: command.operationId, person: actor.person, at: now });
      data.result = payload.result; data.status = next;
      if (next === 'FINALIZADA') data.finalizedAt = now;
    } else if (type === 'assign') {
      central(actor);
      if (!data.operator || data.operator.id !== actor.person.id) throw new Error('Solo el operador asignado puede cambiar el conductor');
      if (data.messages.length) throw new Error('No se puede cambiar el destinatario después de iniciar la conversación');
      data.driverId = required(payload.driverId, 'Conductor'); data.driverName = required(payload.driverName, 'Nombre');
    } else if (type === 'associate') {
      central(actor);
      if (!data.operator || data.operator.id !== actor.person.id) throw new Error('Solo el operador asignado puede asociar eventos');
      const event = eventRef(payload);
      if (!data.eventKeys.includes(event.key)) { data.eventKeys.push(event.key); (data.events || (data.events = [])).push(event); }
    } else if (type === 'read') {
      if (actor.role === 'driver') data.readByDriverAt = now; else data.readByCentralAt = now;
    } else throw new Error('Acción no reconocida');
    if (payload.attachments && payload.attachments.length) {
      if (type !== 'message') throw new Error('Adjunte la evidencia a un mensaje');
      if (payload.attachments.length > 3) throw new Error('Máximo tres adjuntos por mensaje');
      payload.attachments.forEach(file => { validateAttachment(file); data.attachments.push({ ...file, messageId: command.operationId, caseId: data.id, driverId: data.driverId, at: now }); });
    }
    if (previous !== data.status) {
      data.transitions.push({ from: previous, to: data.status, at: now });
      if (data.waitingSince) { data.waitingSeconds += seconds(data.waitingSince, now); data.waitingSince = ''; }
      if (data.followUpSince) { data.followUpSeconds += seconds(data.followUpSince, now); data.followUpSince = ''; }
      if (['ESPERANDO_CONDUCTOR', 'ESPERANDO_ACLARACION'].includes(data.status)) data.waitingSince = now;
      if (FOLLOW_STATES.includes(data.status)) data.followUpSince = now;
    }
    data.version += 1; data.updatedAt = now;
    if (type !== 'read') data.audit.push({ type, actor: actor.role === 'central' ? actor.person.name : actor.name, at: now });
    return data;
  }
  function times(item, now) {
    return { total: seconds(item.occurredAt, item.finalizedAt || now),
      toStart: seconds(item.occurredAt, item.startedAt || item.finalizedAt || now),
      waiting: (item.waitingSeconds || 0) + (item.waitingSince ? seconds(item.waitingSince, item.finalizedAt || now) : 0),
      followUp: (item.followUpSeconds || 0) + (item.followUpSince ? seconds(item.followUpSince, item.finalizedAt || now) : 0) };
  }
  return { STATES, RESULTS, TYPES, CAUSES, ACTIONS, CHANNELS, PRIORITIES, FOLLOW_STATES, FILE_TYPES,
    required, seconds, elapsed, limaDay, month, preset, range, eventKey, eventRef, measurement, validateAttachment, actorCanRead, apply, times };
});
