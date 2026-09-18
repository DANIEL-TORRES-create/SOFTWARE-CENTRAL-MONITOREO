(() => {
  "use strict";

  const CONFIG = Object.freeze({
    googleWebAppUrl: "https://script.google.com/macros/s/AKfycbxH8xtH10bpeLT_vNY5NELldhVTRy2tZfLC8kaD9h_ePrvmhOl6Mz1eNQaqehGCwa_m/exec",
    databaseKey: "ARDEPE",
    allowedGroupIds: ["b2798", "b279A"],
    zoneTypeId: "bFC",
    liveIntervalMs: 15000,
    defaultCenter: [-12.046374, -77.042793]
  });

  const app = {
    api: null,
    map: null,
    marker: null,
    devices: new Map(),
    zones: [],
    rules: [],
    personnel: [],
    eventStates: new Map(),
    storedEvents: [],
    events: [],
    selectedEvent: null,
    currentRule: "ALL",
    liveMode: true,
    timer: null,
    adminToken: "",
    adminRules: [],
    historyCache: new Map(),
    managementCache: new Map(),
    measurementCache: new Map(),
    eventLogCache: new Map(),
    queryNonce: 0,
    historyQueryRunning: false
  };

  const $ = id => document.getElementById(id);

  function installLogoFallback() {
    const logo = $("company-logo");
    const fallback = $("logo-fallback");
    logo.addEventListener("load", () => { logo.hidden = false; fallback.hidden = true; });
    logo.addEventListener("error", () => { logo.hidden = true; fallback.hidden = false; });
    if (logo.complete) {
      logo.hidden = !logo.naturalWidth;
      fallback.hidden = Boolean(logo.naturalWidth);
    }
  }

  function initializeMap() {
    if (!window.L || app.map) return;
    app.map = L.map("map", { center: CONFIG.defaultCenter, zoom: 11, minZoom: 3 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19
    }).addTo(app.map);
  }

  async function initializeApp(api, callback) {
    app.api = api;
    try {
      await loadFleet();
      await refreshCycle();
      startLiveLoop();
      setConnection("online", "En vivo");
    } catch (error) {
      console.error(error);
      setConnection("error", "Error de conexión");
      showToast(error.message || "No se pudo iniciar la central", true);
    } finally {
      if (typeof callback === "function") callback();
    }
  }

  async function loadFleet() {
    const devices = await app.api.call("Get", { typeName: "Device", search: { activeState: "Active" } });
    app.devices.clear();
    (devices || []).forEach(device => {
      const groups = Array.isArray(device.groups) ? device.groups : [];
      const allowed = !CONFIG.allowedGroupIds.length || groups.some(group => CONFIG.allowedGroupIds.includes(group.id));
      if (allowed && device.serialNumber !== "000-000-0000") {
        app.devices.set(device.id, { id: device.id, name: String(device.name || device.id).toUpperCase() });
      }
    });
    const zones = await app.api.call("Get", { typeName: "Zone" });
    app.zones = (zones || []).filter(zone => Array.isArray(zone.zoneTypes) && zone.zoneTypes.some(type => type.id === CONFIG.zoneTypeId));
  }

  async function refreshCycle() {
    if (!app.api) return;
    setConnection("connecting", "Sincronizando…");
    const range = getQueryRange();
    await loadBootstrap(range);
    const queryNonce = ++app.queryNonce;
    const cacheKey = historicalCacheKey(range);
    const cached = !app.liveMode ? app.historyCache.get(cacheKey) : null;
    let events;
    if (cached && Date.now() - cached.createdAt < 300000) {
      events = cached.events.map(event => ({ ...event }));
    } else {
      events = await queryGeotabEvents(range.fromDate, range.toDate, !app.liveMode);
      if (queryNonce !== app.queryNonce) return;
      if (!app.liveMode) app.historyCache.set(cacheKey, { createdAt: Date.now(), events: events.map(event => ({ ...event })) });
    }
    events = mergeStoredEvents(events, app.storedEvents);
    preserveResolvedContext(events);
    app.events = events.sort((a, b) => new Date(b.activeFrom) - new Date(a.activeFrom));
    if (app.liveMode) await syncUnknownEvents(app.events);
    mergeStates();
    renderAll();
    setConnection("online", app.liveMode ? "En vivo" : "Consulta histórica");
  }

  async function loadBootstrap(range) {
    validateBackendUrl();
    const result = await getJson({ action: "bootstrap", mode: app.liveMode ? "live" : "history",
      fromDate: range.fromDate, toDate: range.toDate });
    if (!result.success) throw new Error(result.message || "No se pudo leer el backend");
    app.personnel = result.personnel || [];
    app.rules = result.rules || [];
    app.storedEvents = (result.storedEvents || []).map(hydrateStoredEvent);
    app.eventStates = new Map((result.eventStates || []).map(state => [state.eventKey, state]));
    renderPersonnel();
    renderRuleFilters();
  }

  function hydrateStoredEvent(event) {
    const rule = app.rules.find(item => item.id === event.ruleId) || {
      id: event.ruleId, name: event.ruleName, category: ""
    };
    const measurementKind = getMeasurementKind(rule);
    const detected = String(event.detectedValue || "");
    return {
      ...event,
      ruleName: event.ruleName || rule.name || "Evento Geotab",
      priority: String(event.priority || rule.priority || "MEDIA").toUpperCase(),
      plate: event.plate || "SIN IDENTIFICAR",
      latitude: numberOrNull(event.latitude),
      longitude: numberOrNull(event.longitude),
      driver: event.driver || "POR CONSULTAR",
      zone: event.zone || "POR CONSULTAR",
      status: event.status || "PENDIENTE",
      measurementKind,
      contextResolved: Boolean(event.driver && event.driver !== "POR CONSULTAR" && event.zone && event.zone !== "POR CONSULTAR"),
      measurementResolved: Boolean(detected && !/CONSULTAR|DETECTADO POR REGLA/i.test(detected))
    };
  }

  function mergeStoredEvents(geotabEvents, storedEvents) {
    const merged = new Map((geotabEvents || []).map(event => [event.eventKey, event]));
    (storedEvents || []).forEach(stored => {
      const current = merged.get(stored.eventKey);
      merged.set(stored.eventKey, current ? { ...stored, ...current,
        operatorName: stored.operatorName, operatorArea: stored.operatorArea } : { ...stored });
    });
    return [...merged.values()];
  }

  async function queryGeotabEvents(fromDate, toDate, showProgress) {
    const groups = [];
    for (let index = 0; index < app.rules.length; index += 1) {
      const rule = app.rules[index];
      if (showProgress) setHistoryProgress(`Consultando ${rule.name} (${index + 1}/${app.rules.length})…`);
      const search = { ruleSearch: { id: rule.geotabRuleId }, fromDate };
      if (toDate) search.toDate = toDate;
      const result = await app.api.call("Get", { typeName: "ExceptionEvent", search });
      groups.push((result || []).map(event => normalizeEvent(event, rule)));
      if (showProgress && index < app.rules.length - 1) await wait(120);
    }
    const unique = new Map();
    groups.flat().forEach(event => {
      if (app.devices.has(event.deviceId)) unique.set(event.eventKey, event);
    });
    return [...unique.values()];
  }

  function normalizeEvent(event, rule) {
    const geotabEventId = cleanId(event.id);
    const device = app.devices.get(event.device && event.device.id);
    const measurementKind = getMeasurementKind(rule);
    return {
      eventKey: `${CONFIG.databaseKey}:${geotabEventId}`,
      geotabEventId,
      ruleId: rule.id,
      ruleName: rule.name,
      priority: String(rule.priority || "MEDIA").toUpperCase(),
      deviceId: event.device ? event.device.id : "",
      plate: device ? device.name : "SIN IDENTIFICAR",
      activeFrom: event.activeFrom,
      activeTo: event.activeTo || "",
      latitude: numberOrNull(event.latitude),
      longitude: numberOrNull(event.longitude),
      detectedValue: buildDetectedValue(event, measurementKind),
      measurementKind,
      driver: "POR CONSULTAR",
      zone: "POR CONSULTAR",
      status: "PENDIENTE",
      startedAt: "",
      closedAt: "",
      elapsedSeconds: 0,
      operatorId: "",
      contextResolved: false,
      measurementResolved: !["speed", "acceleration", "braking", "cornering"].includes(measurementKind)
    };
  }

  function buildDetectedValue(event, measurementKind) {
    if (measurementKind === "stop") return formatElapsed(secondsBetween(event.activeFrom, event.activeTo || new Date().toISOString()));
    if (["speed", "acceleration", "braking", "cornering"].includes(measurementKind)) return "Consultar valor máximo";
    if (event.duration != null && Number(event.duration) > 0) return `${Math.round(Number(event.duration))} s`;
    if (event.distance != null && Number(event.distance) > 0) return `${Number(event.distance).toFixed(2)} km`;
    return "Evento detectado por Geotab";
  }

  function getMeasurementKind(rule) {
    const text = normalizeSearchText(`${rule.id || ""} ${rule.name || ""} ${rule.category || ""}`);
    if (/PARADA|DETENCION|STOP/.test(text)) return "stop";
    if (/VELOCIDAD|SPEED/.test(text)) return "speed";
    if (/FRENAD|BRAK/.test(text)) return "braking";
    if (/GIRO|CURVA|CORNER|LATERAL/.test(text)) return "cornering";
    if (/ACELER/.test(text)) return "acceleration";
    return "generic";
  }

  async function syncUnknownEvents(events) {
    const unknown = events.filter(event => !app.eventStates.has(event.eventKey));
    for (let index = 0; index < unknown.length; index += 80) {
      const batch = unknown.slice(index, index + 80).map(event => ({
        eventKey: event.eventKey,
        geotabEventId: event.geotabEventId,
        ruleId: event.ruleId,
        ruleName: event.ruleName,
        deviceId: event.deviceId,
        plate: event.plate,
        activeFrom: event.activeFrom,
        activeTo: event.activeTo,
        latitude: event.latitude,
        longitude: event.longitude,
        detectedValue: event.measurementResolved ? event.detectedValue : "",
        priority: event.priority
      }));
      await postOperation("syncEvents", { eventsJson: JSON.stringify(batch) });
      batch.forEach(item => app.eventStates.set(item.eventKey, { eventKey: item.eventKey, status: "PENDIENTE", startedAt: "", closedAt: "", elapsedSeconds: 0, operatorId: "" }));
    }
  }

  async function ensureEventStored(event) {
    if (app.eventStates.has(event.eventKey)) return;
    await syncUnknownEvents([event]);
  }

  function mergeStates() {
    app.events.forEach(event => {
      const state = app.eventStates.get(event.eventKey);
      if (!state) return;
      const resolvedDriver = event.driver;
      const resolvedZone = event.zone;
      const calculatedDetectedValue = event.detectedValue;
      const calculatedMeasurementResolved = event.measurementResolved;
      Object.assign(event, state);
      event.driver = state.driver || resolvedDriver || "POR CONSULTAR";
      event.zone = state.zone || resolvedZone || "POR CONSULTAR";
      event.detectedValue = calculatedDetectedValue;
      event.measurementResolved = calculatedMeasurementResolved;
      const usesStoredMaximum = ["speed", "acceleration", "braking", "cornering"].includes(event.measurementKind);
      if (usesStoredMaximum && state.detectedValue && !/CONSULTAR|DETECTADO POR REGLA/i.test(state.detectedValue)) {
        event.detectedValue = state.detectedValue;
        event.measurementResolved = true;
      }
    });
  }

  function preserveResolvedContext(nextEvents) {
    const previous = new Map(app.events.map(event => [event.eventKey, event]));
    nextEvents.forEach(event => {
      const old = previous.get(event.eventKey);
      if (!old) return;
      if (old.driver && old.driver !== "POR CONSULTAR") event.driver = old.driver;
      if (old.zone && old.zone !== "POR CONSULTAR") event.zone = old.zone;
      if (validCoordinate(old.latitude, old.longitude)) {
        event.latitude = old.latitude;
        event.longitude = old.longitude;
      }
      event.contextResolved = Boolean(old.contextResolved);
      if (old.measurementResolved) {
        event.detectedValue = old.detectedValue;
        event.measurementResolved = true;
      }
    });
  }

  function renderAll() {
    renderEvents();
    renderMetrics();
    if (app.selectedEvent) {
      const fresh = app.events.find(event => event.eventKey === app.selectedEvent.eventKey);
      if (fresh) selectEvent(fresh, false);
      else clearDetail();
    }
  }

  function renderPersonnel() {
    const select = $("session-person");
    const previous = select.value || sessionStorage.getItem("centralPersonId") || "";
    select.replaceChildren(new Option("Seleccione personal", ""));
    app.personnel.filter(person => person.active).forEach(person => select.add(new Option(`${person.name} · ${person.area}`, person.id)));
    if (app.personnel.some(person => person.id === previous && person.active)) select.value = previous;
  }

  function renderRuleFilters() {
    const container = $("rule-filters");
    container.replaceChildren();
    [{ id: "ALL", name: "Todas" }, ...app.rules].forEach(rule => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `rule-filter${app.currentRule === rule.id ? " active" : ""}`;
      button.textContent = rule.name;
      button.addEventListener("click", () => {
        app.currentRule = rule.id;
        renderRuleFilters();
        renderEvents();
        renderMetrics();
      });
      container.appendChild(button);
    });
  }

  function filteredEvents() {
    const status = $("status-filter").value;
    const priority = $("priority-filter").value;
    const search = $("search-filter").value.trim().toLowerCase();
    return app.events.filter(event => {
      const matchesRule = app.currentRule === "ALL" || event.ruleId === app.currentRule;
      const matchesPriority = priority === "ALL" || event.priority === priority;
      const open = event.status === "PENDIENTE" || event.status === "EN_GESTION" || event.status === "ESCALADO";
      const closed = event.status === "GESTIONADO" || event.status === "DESCARTADO";
      const matchesStatus = status === "ALL" || (status === "OPEN" && open) || (status === "CLOSED" && closed) || event.status === status;
      const haystack = `${event.plate} ${event.driver} ${event.zone} ${event.ruleName}`.toLowerCase();
      return matchesRule && matchesPriority && matchesStatus && (!search || haystack.includes(search));
    });
  }

  function renderEvents() {
    const container = $("event-list");
    const events = filteredEvents();
    container.replaceChildren();
    $("visible-count").textContent = `${events.length} ${events.length === 1 ? "evento" : "eventos"}`;
    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No hay eventos que coincidan con los filtros.";
      container.appendChild(empty);
      return;
    }
    events.forEach(event => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `event-card${app.selectedEvent && app.selectedEvent.eventKey === event.eventKey ? " selected" : ""}`;
      const head = document.createElement("div");
      head.className = "event-card-head";
      const plate = document.createElement("strong");
      plate.textContent = event.plate;
      const badge = document.createElement("span");
      badge.className = `status ${statusClass(event.status)}`;
      badge.textContent = statusLabel(event.status);
      head.append(plate, badge);
      const type = document.createElement("div");
      type.className = "event-card-type";
      type.textContent = event.ruleName;
      const operator = document.createElement("div");
      operator.className = "event-card-operator";
      operator.textContent = operatorName(event.operatorId, event.operatorName, event.operatorArea);
      operator.hidden = !["GESTIONADO", "DESCARTADO"].includes(event.status);
      const meta = document.createElement("div");
      meta.className = "event-card-meta";
      const priority = document.createElement("span");
      priority.textContent = event.priority;
      const elapsed = document.createElement("span");
      elapsed.dataset.elapsedFor = event.eventKey;
      elapsed.textContent = displayEventElapsed(event);
      meta.append(priority, elapsed);
      button.append(head, type, operator, meta);
      button.addEventListener("click", () => selectEvent(event, true));
      container.appendChild(button);
    });
  }

  function renderMetrics() {
    const scoped = app.events.filter(event => app.currentRule === "ALL" || event.ruleId === app.currentRule);
    const pending = scoped.filter(event => event.status === "PENDIENTE").length;
    const progress = scoped.filter(event => event.status === "EN_GESTION" || event.status === "ESCALADO").length;
    const today = localDateKey(new Date());
    const managed = scoped.filter(event => ["GESTIONADO", "DESCARTADO"].includes(event.status) && event.closedAt && localDateKey(new Date(event.closedAt)) === today).length;
    const open = scoped.filter(event => !["GESTIONADO", "DESCARTADO"].includes(event.status));
    const oldest = open.reduce((max, event) => Math.max(max, secondsBetween(event.activeFrom, new Date().toISOString())), 0);
    $("metric-pending").textContent = pending;
    $("metric-progress").textContent = progress;
    $("metric-managed").textContent = managed;
    $("metric-oldest").textContent = formatElapsed(oldest);
  }

  async function selectEvent(event, resolveRemote) {
    const changed = !app.selectedEvent || app.selectedEvent.eventKey !== event.eventKey;
    app.selectedEvent = event;
    if (changed) $("management-form").reset();
    $("detail-rule").textContent = event.ruleName;
    $("detail-reference").textContent = `${event.plate} · ${formatDate(event.activeFrom)}`;
    $("detail-priority").textContent = event.priority;
    $("detail-priority").className = `priority-label priority-${String(event.priority).toLowerCase()}`;
    $("detail-plate").textContent = event.plate;
    $("detail-date").textContent = formatDate(event.activeFrom);
    $("detail-value").textContent = event.detectedValue;
    $("detail-driver").textContent = event.driver;
    $("detail-zone").textContent = event.zone;
    $("detail-operator").textContent = operatorName(event.operatorId, event.operatorName, event.operatorArea);
    $("detail-started").textContent = formatDate(event.startedAt);
    $("detail-similar").textContent = `${similarEventsToday(event)} evento(s)`;
    updateDetailStatus();
    updateManagementAccess();
    renderEvents();
    if (resolveRemote) await resolveEventContext(event);
    if (["GESTIONADO", "DESCARTADO"].includes(event.status)) await loadEventManagement(event);
  }

  async function loadEventManagement(event) {
    try {
      let result = app.managementCache.get(event.eventKey);
      if (!result) {
        result = await getJson({ action: "eventManagement", eventKey: event.eventKey, activeFrom: event.activeFrom });
        if (result.success) app.managementCache.set(event.eventKey, result);
      }
      if (!result.success || !result.management || !app.selectedEvent || app.selectedEvent.eventKey !== event.eventKey) return;
      const management = result.management;
      $("result").value = management.result;
      $("contact").value = management.contact;
      $("driver-statement").value = management.driverStatement;
      $("cause").value = management.cause;
      $("immediate-action").value = management.immediateAction;
      $("corrective-action").value = management.correctiveAction;
      $("follow-up").value = management.followUp;
      $("follow-up-owner").value = management.followUpOwner;
      $("commitment-date").value = management.commitmentDate;
      $("evidence").value = management.evidence;
      $("notes").value = management.notes;
      $("management-mode").textContent = `Gestionada por ${management.personName} · ${management.personArea}`;
    } catch (error) {
      console.error("No se pudo leer la gestión", error);
    }
  }

  async function resolveEventContext(event) {
    if (event.contextResolved && event.measurementResolved) {
      if (validCoordinate(event.latitude, event.longitude)) showOnMap(event.latitude, event.longitude);
      return;
    }
    setContextLoading(true);
    if (!event.measurementResolved) setInlineLoading($("detail-value"), "Calculando valor máximo…");
    if (!event.contextResolved) {
      setInlineLoading($("detail-driver"), "Consultando Geotab…");
      setInlineLoading($("detail-zone"), "Consultando ubicación…");
    }
    try {
      if (!event.measurementResolved) {
        event.detectedValue = await resolveDetectedValue(event);
        event.measurementResolved = true;
        if (app.selectedEvent && app.selectedEvent.eventKey === event.eventKey) $("detail-value").textContent = event.detectedValue;
      }
      if (!event.contextResolved) {
        let lat = event.latitude;
        let lng = event.longitude;
        if (!validCoordinate(lat, lng)) {
          const cachedLogs = app.eventLogCache.get(event.eventKey);
          const logs = cachedLogs || await app.api.call("Get", { typeName: "LogRecord", search: { deviceSearch: { id: event.deviceId }, fromDate: event.activeFrom, toDate: event.activeTo || new Date().toISOString() } });
          const positioned = (logs || []).find(log => validCoordinate(numberOrNull(log.latitude), numberOrNull(log.longitude)));
          if (positioned) { lat = numberOrNull(positioned.latitude); lng = numberOrNull(positioned.longitude); }
        }
        event.latitude = lat;
        event.longitude = lng;
        if (validCoordinate(lat, lng)) {
          showOnMap(lat, lng);
          event.zone = findZoneName(lat, lng) || await reverseGeocode(lat, lng);
        } else event.zone = "UBICACIÓN NO DISPONIBLE";
        event.driver = await getCurrentDriver(event.deviceId);
        event.contextResolved = true;
        if (app.selectedEvent && app.selectedEvent.eventKey === event.eventKey) {
          $("detail-driver").textContent = event.driver;
          $("detail-zone").textContent = event.zone;
        }
      }
    } catch (error) {
      console.error("No se pudo completar el contexto", error);
      event.contextResolved = true;
      if (!event.measurementResolved) {
        event.measurementResolved = true;
        event.detectedValue = "VALOR NO DISPONIBLE";
      }
      if (app.selectedEvent && app.selectedEvent.eventKey === event.eventKey) {
        $("detail-value").textContent = event.detectedValue;
        $("detail-driver").textContent = event.driver || "NO DISPONIBLE";
        $("detail-zone").textContent = event.zone || "NO DISPONIBLE";
      }
    } finally {
      setContextLoading(false);
    }
  }

  async function resolveDetectedValue(event) {
    const cached = app.measurementCache.get(event.eventKey);
    if (cached) return cached;
    let value = "VALOR NO DISPONIBLE";
    if (event.measurementKind === "speed") {
      const logs = await getEventLogRecords(event);
      const speeds = logs.map(log => Number(log.speed)).filter(speed => isFinite(speed) && speed >= 0);
      if (speeds.length) value = `${Math.round(speeds.reduce((max, speed) => Math.max(max, speed), 0))} km/h · velocidad máxima`;
    } else {
      const diagnosticId = event.measurementKind === "cornering"
        ? "DiagnosticAccelerationSideToSideId"
        : "DiagnosticAccelerationForwardBrakingId";
      const samples = await app.api.call("Get", {
        typeName: "StatusData",
        search: {
          deviceSearch: { id: event.deviceId },
          diagnosticSearch: { id: diagnosticId },
          fromDate: paddedEventDate(event.activeFrom, -2),
          toDate: paddedEventDate(event.activeTo || new Date().toISOString(), 2)
        }
      });
      const readings = (samples || []).map(sample => Number(sample.data)).filter(reading => isFinite(reading));
      if (readings.length) {
        let peak;
        let label;
        if (event.measurementKind === "acceleration") {
          peak = readings.reduce((max, reading) => Math.max(max, reading), -Infinity);
          label = "aceleración máxima";
        } else if (event.measurementKind === "braking") {
          peak = Math.abs(readings.reduce((min, reading) => Math.min(min, reading), Infinity));
          label = "frenada máxima";
        } else {
          peak = readings.reduce((max, reading) => Math.max(max, Math.abs(reading)), 0);
          label = "fuerza lateral máxima";
        }
        if (isFinite(peak)) value = `${peak.toFixed(2)} g · ${label}`;
      }
    }
    app.measurementCache.set(event.eventKey, value);
    return value;
  }

  async function getEventLogRecords(event) {
    if (app.eventLogCache.has(event.eventKey)) return app.eventLogCache.get(event.eventKey);
    const logs = await app.api.call("Get", {
      typeName: "LogRecord",
      search: {
        deviceSearch: { id: event.deviceId },
        fromDate: paddedEventDate(event.activeFrom, -2),
        toDate: paddedEventDate(event.activeTo || new Date().toISOString(), 2)
      }
    });
    app.eventLogCache.set(event.eventKey, logs || []);
    return logs || [];
  }

  function paddedEventDate(value, seconds) {
    const date = new Date(value);
    return new Date(date.getTime() + seconds * 1000).toISOString();
  }

  async function getCurrentDriver(deviceId) {
    try {
      const statuses = await app.api.call("Get", { typeName: "DeviceStatusInfo", search: { deviceSearch: { id: deviceId } } });
      const driver = statuses && statuses[0] && statuses[0].driver;
      if (!driver || driver.id === "NoDriverId") return "SIN CONDUCTOR ASIGNADO";
      const users = await app.api.call("Get", { typeName: "User", search: { id: driver.id } });
      if (!users || !users[0]) return "DESCONOCIDO";
      return `${users[0].firstName || ""} ${users[0].lastName || ""}`.trim().toUpperCase();
    } catch (_) {
      return "NO DISPONIBLE";
    }
  }

  function findZoneName(lat, lng) {
    for (const zone of app.zones) {
      if (!Array.isArray(zone.points) || !zone.points.length) continue;
      const inside = pointInPolygon(lng, lat, zone.points.map(point => [Number(point.x), Number(point.y)]));
      if (inside) return String(zone.name || "ZONA").toUpperCase();
    }
    return "";
  }

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1], xj = polygon[j][0], yj = polygon[j][1];
      const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  async function reverseGeocode(lat, lng) {
    try {
      const addresses = await app.api.call("GetAddresses", { coordinates: [{ x: lng, y: lat }] });
      return addresses && addresses[0] ? String(addresses[0].formattedAddress).toUpperCase() : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch (_) {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }

  function showOnMap(lat, lng) {
    if (!app.map) return;
    app.map.invalidateSize();
    app.map.setView([lat, lng], 16);
    if (app.marker) app.map.removeLayer(app.marker);
    app.marker = L.marker([lat, lng]).addTo(app.map);
  }

  function updateDetailStatus() {
    if (!app.selectedEvent) return;
    const status = $("detail-status");
    status.textContent = statusLabel(app.selectedEvent.status);
    status.className = `status ${statusClass(app.selectedEvent.status)}`;
    $("detail-elapsed").textContent = displayEventElapsed(app.selectedEvent);
  }

  function updateManagementAccess() {
    const event = app.selectedEvent;
    const personId = $("session-person").value;
    const start = $("start-management");
    const fields = $("management-fields");
    if (!event) { start.disabled = true; fields.disabled = true; return; }
    const closed = ["GESTIONADO", "DESCARTADO"].includes(event.status);
    const mine = event.status === "EN_GESTION" && event.operatorId === personId;
    const canStart = event.status === "PENDIENTE" || event.status === "ESCALADO";
    start.hidden = !canStart;
    start.textContent = event.status === "ESCALADO" ? "Continuar gestión" : "Iniciar gestión";
    start.disabled = !personId || !canStart;
    fields.disabled = closed || !mine;
    $("management-mode").textContent = closed ? "Finalizada" : mine ? "En gestión" : event.status === "EN_GESTION" ? "Asignada a otro operador" : "Sin iniciar";
  }

  async function startSelectedManagement() {
    const event = requireSelectedEvent();
    const personId = requireActiveSelection();
    setBusy($("start-management"), true, "Iniciando gestión…");
    try {
      await ensureEventStored(event);
      await postOperation("startManagement", { eventKey: event.eventKey, personId });
      const person = app.personnel.find(item => item.id === personId) || {};
      Object.assign(event, { status: "EN_GESTION", operatorId: personId, operatorName: person.name || "",
        operatorArea: person.area || "", startedAt: new Date().toISOString() });
      app.eventStates.set(event.eventKey, { ...event });
      $("detail-operator").textContent = operatorName(personId, event.operatorName, event.operatorArea);
      $("detail-started").textContent = formatDate(event.startedAt);
      updateDetailStatus();
      updateManagementAccess();
      renderEvents();
      renderMetrics();
      showToast("Gestión iniciada");
    } finally {
      setBusy($("start-management"), false, "Iniciar gestión");
    }
  }

  async function completeSelectedManagement(eventObject) {
    eventObject.preventDefault();
    const event = requireSelectedEvent();
    const personId = requireActiveSelection();
    const submit = eventObject.submitter;
    setBusy(submit, true, "Guardando y verificando…");
    try {
      const result = await postOperation("completeManagement", {
        eventKey: event.eventKey,
        personId,
        result: $("result").value,
        contact: $("contact").value,
        driverStatement: $("driver-statement").value,
        cause: $("cause").value,
        immediateAction: $("immediate-action").value,
        correctiveAction: $("corrective-action").value,
        followUp: $("follow-up").value,
        followUpOwner: $("follow-up-owner").value,
        commitmentDate: $("commitment-date").value,
        evidence: $("evidence").value,
        notes: $("notes").value,
        driver: event.driver,
        zone: event.zone,
        detectedValue: event.detectedValue
      });
      Object.assign(event, { status: result.status,
        closedAt: ["GESTIONADO", "DESCARTADO"].includes(result.status) ? new Date().toISOString() : "",
        elapsedSeconds: result.elapsedSeconds,
        operatorName: result.operatorName || event.operatorName, operatorArea: result.operatorArea || event.operatorArea });
      app.eventStates.set(event.eventKey, { ...event });
      app.managementCache.delete(event.eventKey);
      updateDetailStatus();
      updateManagementAccess();
      renderEvents();
      renderMetrics();
      showToast("Gestión registrada correctamente");
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setBusy(submit, false, "Registrar gestión");
    }
  }

  function bindUi() {
    $("session-person").addEventListener("change", event => {
      sessionStorage.setItem("centralPersonId", event.target.value);
      updateManagementAccess();
    });
    ["status-filter", "priority-filter"].forEach(id => $(id).addEventListener("change", () => { renderEvents(); renderMetrics(); }));
    $("search-filter").addEventListener("input", renderEvents);
    $("start-management").addEventListener("click", () => startSelectedManagement().catch(error => showToast(error.message, true)));
    $("management-form").addEventListener("submit", completeSelectedManagement);
    $("history-form").addEventListener("submit", runHistorical);
    $("history-button").addEventListener("click", openHistoryModal);
    $("close-history").addEventListener("click", closeHistoryModal);
    $("cancel-history").addEventListener("click", closeHistoryModal);
    document.querySelectorAll("[data-history-range]").forEach(button => button.addEventListener("click", () => setHistoryPreset(button.dataset.historyRange)));
    ["date-from", "date-to"].forEach(id => $(id).addEventListener("input", clearHistoryPresetSelection));
    $("live-button").addEventListener("click", returnToLive);
    $("guide-button").addEventListener("click", () => { $("guide-modal").hidden = false; });
    $("close-guide").addEventListener("click", () => { $("guide-modal").hidden = true; });
    $("expand-map").addEventListener("click", toggleMapSize);
    $("history-modal").addEventListener("click", event => {
      if (event.target === $("history-modal")) closeHistoryModal();
    });
    $("guide-modal").addEventListener("click", event => {
      if (event.target === $("guide-modal")) $("guide-modal").hidden = true;
    });
    bindAdminUi();
  }

  function bindAdminUi() {
    $("admin-button").addEventListener("click", () => { $("admin-modal").hidden = false; $("admin-pin").focus(); });
    $("close-admin").addEventListener("click", () => { $("admin-modal").hidden = true; });
    $("admin-login").addEventListener("submit", adminLogin);
    $("person-form").addEventListener("submit", savePerson);
    $("rule-form").addEventListener("submit", saveRule);
    document.querySelectorAll(".admin-tab").forEach(button => button.addEventListener("click", () => switchAdminTab(button.dataset.adminTab)));
  }

  async function adminLogin(event) {
    event.preventDefault();
    const submit = event.submitter;
    setBusy(submit, true, "Validando…");
    try {
      const result = await postOperation("adminLogin", { pin: $("admin-pin").value });
      app.adminToken = result.adminToken;
      $("admin-login").hidden = true;
      $("admin-content").hidden = false;
      await loadAdminData();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setBusy(submit, false, "Ingresar");
    }
  }

  async function loadAdminData() {
    const result = await getJson({ action: "adminData", adminToken: app.adminToken });
    if (!result.success) throw new Error(result.message || "No se pudo abrir administración");
    app.personnel = result.personnel || [];
    app.adminRules = result.rules || [];
    renderAdminPeople();
    renderAdminRules();
    renderPersonnel();
  }

  function renderAdminPeople() {
    const container = $("people-list");
    container.replaceChildren();
    app.personnel.forEach(person => {
      const row = adminListRow(person.name, `${person.area} · ${person.active ? "ACTIVO" : "INACTIVO"}`, "Editar", () => fillPersonForm(person));
      container.appendChild(row);
    });
  }

  function renderAdminRules() {
    const container = $("rules-list");
    container.replaceChildren();
    app.adminRules.forEach(rule => {
      const subtitle = `${rule.priority} · ${rule.active ? "ACTIVA" : "INACTIVA"} · ${rule.geotabRuleId || "SIN ID GEOTAB"}`;
      container.appendChild(adminListRow(rule.name, subtitle, "Editar", () => fillRuleForm(rule)));
    });
  }

  function adminListRow(title, subtitle, actionText, action) {
    const row = document.createElement("div");
    row.className = "admin-list-row";
    const info = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent = subtitle;
    info.append(strong, small);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary";
    button.textContent = actionText;
    button.addEventListener("click", action);
    row.append(info, button);
    return row;
  }

  function fillPersonForm(person) {
    $("person-id").value = person.id;
    $("person-name").value = person.name;
    $("person-area").value = person.area;
    $("person-active").checked = person.active;
  }

  function fillRuleForm(rule) {
    $("rule-id").value = rule.id;
    $("rule-geotab-id").value = rule.geotabRuleId;
    $("rule-name").value = rule.name;
    $("rule-category").value = rule.category;
    $("rule-priority").value = rule.priority;
    $("rule-active").checked = rule.active;
  }

  async function savePerson(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = event.submitter;
    setBusy(submit, true, "Guardando…");
    try {
      await postOperation("savePerson", {
        adminToken: app.adminToken,
        personId: $("person-id").value,
        name: $("person-name").value,
        area: $("person-area").value,
        active: $("person-active").checked
      });
      form.reset();
      $("person-id").value = "";
      $("person-active").checked = true;
      await loadAdminData();
      showToast("Personal actualizado");
    } catch (error) { showToast(error.message, true); }
    finally { setBusy(submit, false, "Guardar personal"); }
  }

  async function saveRule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = event.submitter;
    setBusy(submit, true, "Guardando…");
    try {
      await postOperation("saveRule", {
        adminToken: app.adminToken,
        ruleId: $("rule-id").value,
        geotabRuleId: $("rule-geotab-id").value,
        name: $("rule-name").value,
        category: $("rule-category").value,
        priority: $("rule-priority").value,
        active: $("rule-active").checked,
        sortOrder: 100
      });
      form.reset();
      $("rule-id").value = "";
      await loadAdminData();
      renderRuleFilters();
      showToast("Regla actualizada");
    } catch (error) { showToast(error.message, true); }
    finally { setBusy(submit, false, "Guardar regla"); }
  }

  function switchAdminTab(tab) {
    document.querySelectorAll(".admin-tab").forEach(button => button.classList.toggle("active", button.dataset.adminTab === tab));
    $("admin-people").hidden = tab !== "people";
    $("admin-rules").hidden = tab !== "rules";
  }

  async function postOperation(action, values) {
    validateBackendUrl();
    const operationId = createId();
    const body = new URLSearchParams({ action, operationId });
    Object.entries(values || {}).forEach(([key, value]) => body.append(key, value == null ? "" : String(value)));
    await fetch(CONFIG.googleWebAppUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(500);
      const status = await getJson({ action: "operationStatus", operationId });
      if (!status.pending) {
        if (!status.success) throw new Error(status.message || "La operación fue rechazada");
        return status;
      }
    }
    throw new Error("No se pudo confirmar la operación con Google Sheets");
  }

  async function getJson(params) {
    const url = new URL(CONFIG.googleWebAppUrl);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value == null ? "" : String(value)));
    url.searchParams.set("_", Date.now());
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) throw new Error(`Error del backend (${response.status})`);
    return response.json();
  }

  async function runHistorical(event) {
    event.preventDefault();
    if (app.historyQueryRunning) return;
    const from = new Date($("date-from").value);
    const to = new Date($("date-to").value);
    if (!isFinite(from) || !isFinite(to)) return showToast("Selecciona las fechas Desde y Hasta", true);
    if (from >= to) return showToast("La fecha Hasta debe ser posterior", true);
    if (to - from > 7 * 24 * 60 * 60 * 1000) return showToast("La consulta histórica permite un máximo de 7 días", true);
    const submit = event.submitter || $("apply-history");
    app.historyQueryRunning = true;
    $("close-history").disabled = true;
    $("cancel-history").disabled = true;
    setBusy(submit, true, "Consultando…");
    $("history-progress").hidden = false;
    stopLiveLoop();
    app.liveMode = false;
    $("status-filter").value = $("history-status-filter").value;
    try {
      await refreshCycle();
      $("history-modal").hidden = true;
      $("history-banner").hidden = false;
      $("history-range-label").textContent = `${formatDate(from)} — ${formatDate(to)}`;
      showToast(`Consulta completada: ${app.events.length} evento(s)`);
    } catch (error) {
      app.liveMode = true;
      startLiveLoop();
      setConnection("error", "Error de consulta");
      showToast(error.message || "No se pudo consultar el histórico", true);
    } finally {
      app.historyQueryRunning = false;
      $("close-history").disabled = false;
      $("cancel-history").disabled = false;
      $("history-progress").hidden = true;
      setBusy(submit, false, "Consultar");
    }
  }

  function returnToLive() {
    app.queryNonce += 1;
    app.liveMode = true;
    $("history-banner").hidden = true;
    $("status-filter").value = "OPEN";
    setDefaultDates();
    startLiveLoop();
    refreshCycle().catch(error => showToast(error.message, true));
  }

  function openHistoryModal() {
    setDefaultDates();
    $("history-modal").hidden = false;
    $("date-from").focus();
  }

  function closeHistoryModal() {
    if (app.historyQueryRunning) return;
    $("history-modal").hidden = true;
  }

  function setHistoryPreset(preset) {
    const now = new Date();
    let from = new Date(now);
    let to = new Date(now);
    if (preset === "today") from.setHours(0, 0, 0, 0);
    if (preset === "yesterday") {
      from.setDate(from.getDate() - 1);
      from.setHours(0, 0, 0, 0);
      to = new Date(from);
      to.setHours(23, 59, 59, 999);
    }
    if (preset === "7days") {
      to.setDate(to.getDate() - 1);
      to.setHours(23, 59, 59, 999);
      from = new Date(to);
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
    }
    $("date-from").value = localInputValue(from);
    $("date-to").value = localInputValue(to);
    document.querySelectorAll("[data-history-range]").forEach(button => {
      const selected = button.dataset.historyRange === preset;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function clearHistoryPresetSelection() {
    document.querySelectorAll("[data-history-range]").forEach(button => {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    });
  }

  function setHistoryProgress(text) {
    const container = $("history-progress");
    if (!container) return;
    const label = container.querySelector("span:last-child");
    if (label) label.textContent = text;
  }

  function historicalCacheKey(range) {
    const rules = app.rules.map(rule => rule.geotabRuleId).sort().join("|");
    return `${range.fromDate}|${range.toDate}|${rules}`;
  }

  function getQueryRange() {
    if (!app.liveMode) return { fromDate: new Date($("date-from").value).toISOString(), toDate: new Date($("date-to").value).toISOString() };
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { fromDate: start.toISOString(), toDate: "" };
  }

  function setDefaultDates() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    $("date-from").value = localInputValue(start);
    $("date-to").value = localInputValue(end);
    clearHistoryPresetSelection();
  }

  function startLiveLoop() {
    stopLiveLoop();
    app.timer = setInterval(() => refreshCycle().catch(error => { console.error(error); setConnection("error", "Error de sincronización"); }), CONFIG.liveIntervalMs);
  }

  function stopLiveLoop() {
    if (app.timer) clearInterval(app.timer);
    app.timer = null;
  }

  function tickElapsed() {
    document.querySelectorAll("[data-elapsed-for]").forEach(element => {
      const event = app.events.find(item => item.eventKey === element.dataset.elapsedFor);
      if (event) element.textContent = displayEventElapsed(event);
    });
    if (app.selectedEvent) $("detail-elapsed").textContent = displayEventElapsed(app.selectedEvent);
    renderMetrics();
  }

  function displayEventElapsed(event) {
    if (["GESTIONADO", "DESCARTADO"].includes(event.status) && Number(event.elapsedSeconds) >= 0) return formatElapsed(Number(event.elapsedSeconds));
    return formatElapsed(secondsBetween(event.activeFrom, new Date().toISOString()));
  }

  function statusClass(status) {
    return status === "EN_GESTION" ? "progress" : status === "GESTIONADO" ? "managed" : status === "DESCARTADO" ? "dismissed" : status === "ESCALADO" ? "escalated" : "pending";
  }

  function statusLabel(status) {
    return ({ PENDIENTE: "PENDIENTE", EN_GESTION: "EN GESTIÓN", GESTIONADO: "GESTIONADO", DESCARTADO: "DESCARTADO", ESCALADO: "ESCALADO" })[status] || status;
  }

  function clearDetail() {
    app.selectedEvent = null;
    ["detail-rule", "detail-reference", "detail-priority", "detail-plate", "detail-driver", "detail-date", "detail-value", "detail-operator", "detail-started", "detail-similar", "detail-zone"].forEach(id => $(id).textContent = "—");
    updateManagementAccess();
  }

  function setConnection(type, text) {
    const status = $("connection-status");
    status.className = `connection-status ${type}`;
    status.replaceChildren();
    if (type === "connecting") {
      const spinner = document.createElement("span");
      spinner.className = "spinner spinner-small";
      status.appendChild(spinner);
    }
    status.appendChild(document.createTextNode(text));
  }

  function showToast(message, isError) {
    const toast = $("toast");
    toast.textContent = message;
    toast.className = `toast${isError ? " error" : ""}`;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 4500);
  }

  function setBusy(button, busy, text) {
    if (!button) return;
    button.disabled = busy;
    button.replaceChildren();
    if (busy) {
      const spinner = document.createElement("span");
      spinner.className = "spinner spinner-small";
      button.appendChild(spinner);
    }
    button.appendChild(document.createTextNode(text));
  }

  function setInlineLoading(element, text) {
    if (!element) return;
    element.replaceChildren();
    const spinner = document.createElement("span");
    spinner.className = "spinner spinner-small inline-spinner";
    element.append(spinner, document.createTextNode(text));
  }

  function setContextLoading(loading) {
    $("map-loading").hidden = !loading;
  }

  function toggleMapSize() {
    const panel = document.querySelector(".context-panel");
    const expanded = panel.classList.toggle("map-expanded");
    $("expand-map").textContent = expanded ? "Reducir mapa" : "Ampliar mapa";
    if (app.map) setTimeout(() => app.map.invalidateSize(), 80);
  }

  function operatorName(operatorId, snapshotName, snapshotArea) {
    if (snapshotName) return `${snapshotName}${snapshotArea ? ` · ${snapshotArea}` : ""}`;
    if (!operatorId) return "NO ASIGNADO";
    const person = app.personnel.find(item => item.id === operatorId);
    return person ? `${person.name} · ${person.area}` : "PERSONAL REGISTRADO";
  }

  function similarEventsToday(event) {
    const eventDate = localDateKey(new Date(event.activeFrom));
    return app.events.filter(item => item.plate === event.plate && item.ruleId === event.ruleId && localDateKey(new Date(item.activeFrom)) === eventDate).length;
  }

  function requireSelectedEvent() {
    if (!app.selectedEvent) throw new Error("Selecciona un evento");
    return app.selectedEvent;
  }

  function requireActiveSelection() {
    const id = $("session-person").value;
    if (!id || !app.personnel.some(person => person.id === id && person.active)) throw new Error("Selecciona personal activo");
    return id;
  }

  function validateBackendUrl() {
    if (!CONFIG.googleWebAppUrl || CONFIG.googleWebAppUrl.includes("PEGAR_AQUI")) throw new Error("Configura googleWebAppUrl en app.js");
  }

  function secondsBetween(from, to) {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return isFinite(start) && isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
  }

  function formatElapsed(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function formatDate(value) { return value ? new Date(value).toLocaleString("es-PE") : "—"; }
  function localDateKey(value) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
  function localInputValue(value) { const offset = value.getTimezoneOffset() * 60000; return new Date(value.getTime() - offset).toISOString().slice(0, 16); }
  function cleanId(value) { return String(value == null ? "" : value).replace(/[\r\n\s]+/g, "").trim(); }
  function normalizeSearchText(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
  function numberOrNull(value) { if (value == null || value === "") return null; const number = Number(value); return isFinite(number) ? number : null; }
  function validCoordinate(lat, lng) { return lat != null && lng != null && isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0); }
  function createId() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  setInterval(tickElapsed, 1000);
  installLogoFallback();
  bindUi();
  setDefaultDates();
  initializeMap();

  if (window.geotab && geotab.addin) {
    geotab.addin.ArdepeCentralAlertas = function () {
      return {
        initialize(api, state, callback) { initializeApp(api, callback); },
        focus() { if (app.map) setTimeout(() => app.map.invalidateSize(), 100); },
        blur() {}
      };
    };
  } else {
    setConnection("connecting", "Esperando MyGeotab");
  }
})();
