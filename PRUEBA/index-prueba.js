(() => {
  "use strict";
  const CONFIG = Object.freeze({
    googleWebAppUrl: "https://script.google.com/macros/s/AKfycbwSP990uXyF3cWmWcPjh2AMxYR3fjUkrRWXdjYhwGG5P9Lq0steZi1uEmm80zOhwV3I/exec",
    databaseKey: "ARDEPE",
    allowedVehicleGroupIds: ["b2798", "b279A"],
    driverGroupIds: ["b3271"]
  });
  const app = { api:null, personnel:[], rules:[], devices:new Map(), events:[], selected:null, drivers:null, timer:null, evidenceCache:new Map() };
  const $ = id => document.getElementById(id);

  async function initialize(api, callback) {
    app.api = api;
    try { await refresh(); setConnection("online", "En vivo"); startPolling(); }
    catch (error) { console.error(error); setConnection("error", "Error de conexión"); toast(error.message, true); }
    finally { if (callback) callback(); }
  }

  async function refresh() {
    setConnection("", "Actualizando…");
    const start = new Date(); start.setHours(0,0,0,0);
    const bootstrap = await getJson({ action:"driverTestBootstrap" });
    if (!bootstrap.success) throw new Error(bootstrap.message || "No se pudo leer Apps Script");
    app.personnel = bootstrap.personnel || []; app.rules = bootstrap.rules || [];
    renderPeople();
    const devices = await apiCall("Get", { typeName:"Device", search:{ activeState:"Active" } });
    app.devices.clear();
    (devices || []).forEach(device => {
      const groups = device.groups || [];
      if ((!CONFIG.allowedVehicleGroupIds.length || groups.some(group => CONFIG.allowedVehicleGroupIds.includes(group.id))) && device.serialNumber !== "000-000-0000")
        app.devices.set(device.id, { id:device.id, name:String(device.name || device.id).toUpperCase(), groups });
    });
    const result = [];
    for (const rule of app.rules) {
      const rows = await apiCall("Get", { typeName:"ExceptionEvent", search:{ ruleSearch:{ id:rule.geotabRuleId }, fromDate:start.toISOString() } });
      (rows || []).forEach(raw => { if (raw.device && app.devices.has(raw.device.id)) result.push(normalizeEvent(raw, rule)); });
    }
    const unique = new Map(result.map(event => [event.eventKey, event]));
    app.events = [...unique.values()].sort((a,b) => new Date(b.activeFrom) - new Date(a.activeFrom));
    renderEvents();
    if (app.selected) {
      const fresh = app.events.find(event => event.eventKey === app.selected.eventKey);
      if (fresh) { Object.assign(fresh, app.selected); app.selected = fresh; await loadRequestStatus(fresh); }
    }
    setConnection("online", "En vivo");
  }

  function normalizeEvent(raw, rule) {
    const device = app.devices.get(raw.device.id);
    const seconds = secondsBetween(raw.activeFrom, raw.activeTo || new Date().toISOString());
    return { eventKey:`${CONFIG.databaseKey}:${cleanId(raw.id)}`, geotabEventId:cleanId(raw.id), ruleId:rule.id,
      ruleName:rule.name, priority:rule.priority || "MEDIA", deviceId:raw.device.id, plate:device.name,
      activeFrom:raw.activeFrom, activeTo:raw.activeTo || "", latitude:raw.latitude, longitude:raw.longitude,
      detectedValue:/PARADA|DETENCION|STOP/i.test(`${rule.name} ${rule.category}`) ? formatElapsed(seconds) : "Detectado por regla Geotab",
      driver:"", driverId:"", driverGroupId:"", driverGroupName:"" };
  }

  function renderPeople() {
    const select = $("person"), current = select.value || sessionStorage.getItem("testPerson") || "";
    select.replaceChildren(new Option("Seleccione personal", ""));
    app.personnel.filter(person => person.active).forEach(person => select.add(new Option(`${person.name} · ${person.area}`, person.id)));
    if (app.personnel.some(person => person.id === current && person.active)) select.value = current;
  }

  function renderEvents() {
    const list = $("event-list"); list.replaceChildren(); $("event-count").textContent = String(app.events.length);
    if (!app.events.length) { list.innerHTML = '<div class="empty">No hay eventos de hoy para las reglas activas.</div>'; return; }
    app.events.forEach(event => {
      const button = document.createElement("button"); button.type="button";
      button.className=`event-card${app.selected && app.selected.eventKey === event.eventKey ? " selected" : ""}`;
      const head=document.createElement("div"); head.className="event-head";
      const plate=document.createElement("strong"); plate.textContent=event.plate;
      const priority=document.createElement("small"); priority.textContent=event.priority;
      head.append(plate,priority);
      const rule=document.createElement("p"); rule.textContent=event.ruleName;
      const date=document.createElement("small"); date.textContent=formatDate(event.activeFrom);
      button.append(head,rule,date); button.addEventListener("click",()=>selectEvent(event)); list.appendChild(button);
    });
  }

  async function selectEvent(event) {
    app.selected=event; renderEvents(); $("empty-detail").hidden=true; $("interaction").hidden=false;
    $("selected-reference").textContent=`${event.plate} · ${formatDate(event.activeFrom)}`;
    $("detail-rule").textContent=event.ruleName; $("detail-plate").textContent=event.plate;
    $("detail-date").textContent=formatDate(event.activeFrom); $("detail-value").textContent=event.detectedValue;
    setRequestStatus("SIN ENVIAR"); $("response").hidden=true; $("driver-name").textContent="Consultando conductor…";
    $("driver-group").textContent=""; $("send").disabled=true;
    if (!event.driverId) Object.assign(event, await resolveDriver(event));
    renderDriver(); await loadRequestStatus(event);
  }

  async function resolveDriver(event) {
    try {
      const end=event.activeTo || new Date(new Date(event.activeFrom).getTime()+3600000).toISOString();
      const changes=await apiCall("Get", { typeName:"DriverChange", search:{ deviceSearch:{id:event.deviceId}, fromDate:event.activeFrom, toDate:end, includeOverlappedChanges:true } });
      const valid=(changes||[]).filter(change=>change.driver && change.driver.id && change.driver.id!=="NoDriverId").sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime));
      const change=valid.filter(item=>new Date(item.dateTime)<=new Date(event.activeFrom)).pop() || valid[0];
      if (!change) return {driver:"SIN CONDUCTOR ASIGNADO",driverId:"",driverGroupId:"",driverGroupName:""};
      const users=await apiCall("Get", {typeName:"User",search:{id:change.driver.id}});
      return users && users[0] ? driverFromUser(users[0]) : {driver:"CONDUCTOR NO ENCONTRADO",driverId:"",driverGroupId:"",driverGroupName:""};
    } catch(error) { console.error(error); return {driver:"NO DISPONIBLE",driverId:"",driverGroupId:"",driverGroupName:""}; }
  }

  function driverFromUser(user, groupNames=new Map()) {
    const groups=[...(user.driverGroups||[]),...(user.companyGroups||[])];
    const preferred=groups.find(group=>CONFIG.driverGroupIds.includes(group.id)) || groups[0] || {};
    const name=`${user.firstName||""} ${user.lastName||""}`.trim() || user.name || user.id;
    return { driver:String(name).toUpperCase(), driverId:user.id, userName:user.name||"", groups,
      driverGroupId:preferred.id||"", driverGroupName:String(groupNames.get(preferred.id)||preferred.name||preferred.id||"").toUpperCase() };
  }

  function renderDriver() {
    const event=app.selected; $("driver-name").textContent=event.driver||"SIN CONDUCTOR ASIGNADO";
    $("driver-group").textContent=event.driverGroupName||event.driverGroupId ? `Grupo: ${event.driverGroupName||event.driverGroupId}`:"";
    $("send").disabled=!event.driverId || !$("person").value;
    if (!$("message").value) $("message").value=`Revise el evento ${event.ruleName} del ${formatDate(event.activeFrom)} y registre su descargo.`;
  }

  async function send() {
    if (!app.selected) throw new Error("Seleccione un evento");
    if (!$("person").value) throw new Error("Seleccione al personal de monitoreo");
    if (!app.selected.driverId) throw new Error("Seleccione un conductor");
    const message=$("message").value.trim(); if (!message) throw new Error("Escriba un mensaje");
    busy($("send"),true,"Enviando…");
    try {
      await post("syncDriverTestEvent", { eventJson:JSON.stringify({...app.selected}) });
      await post("sendDriverRequest", { eventKey:app.selected.eventKey, personId:$("person").value,
        driverId:app.selected.driverId, driverName:app.selected.driver, driverGroupId:app.selected.driverGroupId,
        driverGroupName:app.selected.driverGroupName, message });
      setRequestStatus("ENVIADA"); toast("Evento enviado al conductor");
    } finally { busy($("send"),false,"Enviar a Geotab Drive"); renderDriver(); }
  }

  async function loadRequestStatus(event) {
    const result=await getJson({action:"driverRequestStatus",eventKey:event.eventKey,activeFrom:event.activeFrom});
    if (!result.success || !app.selected || app.selected.eventKey!==event.eventKey) return;
    if (result.request) {
      Object.assign(event,{driverId:result.request.driverId,driver:result.request.driverName,driverGroupId:result.request.driverGroupId,driverGroupName:result.request.driverGroupName});
      $("message").value=result.request.message||$("message").value; setRequestStatus(result.request.status); renderDriver();
    }
    if (result.response) {
      const box=$("response"); box.replaceChildren();
      const title=document.createElement("strong"); title.textContent=`Respuesta: ${responseLabel(result.response.responseType)}`;
      const text=document.createElement("span"); text.textContent=result.response.comment;
      const meta=document.createElement("small"); meta.textContent=`${result.response.driverName} · ${formatDate(result.response.createdAt)}`;
      box.append(title,text,meta);
      if(result.response.evidenceFileId){
        const holder=document.createElement("div");holder.className="response-evidence";holder.textContent="Cargando evidencia fotográfica…";box.appendChild(holder);
        try{
          let data=app.evidenceCache.get(result.response.evidenceFileId);
          if(!data){data=await getJson({action:"driverEvidence",requestId:result.response.requestId,fileId:result.response.evidenceFileId});if(data.success)app.evidenceCache.set(result.response.evidenceFileId,data);}
          if(data&&data.success&&app.selected&&app.selected.eventKey===event.eventKey){holder.replaceChildren();const image=document.createElement("img");image.src=data.dataUrl;image.alt="Evidencia enviada por el conductor";const caption=document.createElement("small");caption.textContent=data.name||result.response.evidenceName||"Evidencia fotográfica";holder.append(image,caption);}
          else holder.textContent=data&&data.message?data.message:"No se pudo mostrar la evidencia";
        }catch(error){holder.textContent="No se pudo cargar la evidencia fotográfica";console.error(error);}
      }
      if(result.response.evidenceUrl){const link=document.createElement("a");link.href=result.response.evidenceUrl;link.target="_blank";link.rel="noopener";link.textContent="Abrir fotografía en Drive";box.appendChild(link);}
      box.hidden=false;
    }
  }

  async function openDriverSearch() {
    $("driver-modal").hidden=false; $("driver-results").innerHTML='<div class="empty">Consultando conductores…</div>';
    if (!app.drivers) {
      const [users,groups]=await Promise.all([apiCall("Get",{typeName:"User"}),apiCall("Get",{typeName:"Group"})]);
      const names=new Map((groups||[]).map(group=>[group.id,group.name||group.id]));
      app.drivers=(users||[]).map(user=>driverFromUser(user,names)).filter(driver=>driver.driverId && driver.groups.some(group=>CONFIG.driverGroupIds.includes(group.id)));
    }
    renderDriverResults(); $("driver-query").focus();
  }

  function renderDriverResults() {
    const q=normalize($("driver-query").value), list=$("driver-results"); list.replaceChildren();
    const matches=(app.drivers||[]).filter(driver=>!q||normalize(`${driver.driver} ${driver.userName} ${driver.driverId} ${driver.driverGroupName}`).includes(q));
    if (!matches.length) { list.innerHTML='<div class="empty">No hay conductores del grupo b3271 que coincidan.</div>'; return; }
    matches.slice(0,60).forEach(driver=>{
      const button=document.createElement("button"); button.type="button"; button.className="driver-result";
      const info=document.createElement("span"); const name=document.createElement("strong"); name.textContent=driver.driver;
      const meta=document.createElement("small"); meta.textContent=`${driver.userName||driver.driverId} · ${driver.driverGroupName||driver.driverGroupId}`; info.append(name,meta);
      const id=document.createElement("small"); id.textContent=driver.driverId; button.append(info,id);
      button.addEventListener("click",()=>{Object.assign(app.selected,driver);$("driver-modal").hidden=true;renderDriver();}); list.appendChild(button);
    });
  }

  async function post(action,values) {
    const operationId=crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const body=new URLSearchParams({action,operationId}); Object.entries(values||{}).forEach(([key,value])=>body.append(key,value==null?"":String(value)));
    await fetch(CONFIG.googleWebAppUrl,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});
    for(let i=0;i<20;i++){await wait(500);const result=await getJson({action:"operationStatus",operationId});if(!result.pending){if(!result.success)throw new Error(result.message||"Operación rechazada");return result;}}
    throw new Error("No se confirmó la operación");
  }
  async function getJson(params){const url=new URL(CONFIG.googleWebAppUrl);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v==null?"":String(v)));url.searchParams.set("_",Date.now());const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error(`Backend ${response.status}`);return response.json();}
  function apiCall(method,params){return app.api.call(method,params);}
  function setRequestStatus(value){const node=$("request-status");node.textContent=value;node.className=`status ${value==="RESPONDIDA"?"answered":value==="VISTA"?"viewed":value==="ENVIADA"?"sent":""}`;}
  function responseLabel(v){return({RECONOZCO:"Reconozco el evento",JUSTIFICADO:"Evento justificado",NO_RECONOZCO:"No reconozco el evento",EMERGENCIA:"Emergencia"})[v]||v;}
  function setConnection(type,text){$("connection").className=`connection ${type}`;$("connection").textContent=text;}
  function toast(message,error){const node=$("toast");node.textContent=message;node.className=`toast${error?" error":""}`;node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.hidden=true,4000);}
  function busy(button,on,text){button.disabled=on;button.textContent=text;}
  function formatDate(v){return v?new Date(v).toLocaleString("es-PE"):"—";} function cleanId(v){return String(v||"").replace(/[\s\r\n]+/g,"");}
  function secondsBetween(a,b){return Math.max(0,Math.floor((new Date(b)-new Date(a))/1000)||0);} function formatElapsed(s){return `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor(s%3600/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;}
  function normalize(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();} function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  function startPolling(){clearInterval(app.timer);app.timer=setInterval(()=>{if(app.selected)loadRequestStatus(app.selected).catch(console.error);},10000);}

  $("refresh").addEventListener("click",()=>refresh().catch(error=>toast(error.message,true)));
  $("person").addEventListener("change",event=>{sessionStorage.setItem("testPerson",event.target.value);if(app.selected)renderDriver();});
  $("send").addEventListener("click",()=>send().catch(error=>toast(error.message,true)));
  $("search-driver").addEventListener("click",()=>openDriverSearch().catch(error=>toast(error.message,true)));
  $("driver-query").addEventListener("input",renderDriverResults); $("close-driver").addEventListener("click",()=>$("driver-modal").hidden=true);
  if(window.geotab&&geotab.addin) geotab.addin.ArdepeInteraccionPrueba=()=>({initialize(api,state,callback){initialize(api,callback);},focus(){},blur(){}});
  else setConnection("","Esperando MyGeotab");
})();
