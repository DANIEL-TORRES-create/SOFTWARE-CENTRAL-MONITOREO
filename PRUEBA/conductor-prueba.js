(() => {
  "use strict";
  const BACKEND="https://script.google.com/macros/s/AKfycbwSP990uXyF3cWmWcPjh2AMxYR3fjUkrRWXdjYhwGG5P9Lq0steZi1uEmm80zOhwV3I/exec";
  const app={api:null,user:null,tasks:[],selected:null,timer:null}; const $=id=>document.getElementById(id);

  function initialize(api,callback){
    app.api=api;
    if(callback)callback();
    boot().catch(error=>{console.error(error);setConnection("error","No se pudo identificar al conductor");$("driver-identity").textContent="Conductor no identificado";toast(error.message,true);});
  }

  async function boot(){app.user=await withTimeout(getCurrentUser(),10000,"Geotab Drive no respondió al identificar al conductor");$("driver-identity").textContent=displayName(app.user);await loadTasks();startPolling();}

  async function getCurrentUser(){
    if(!app.api.mobile||!app.api.mobile.user||typeof app.api.mobile.user.get!=="function")throw new Error("Esta página debe abrirse dentro de Geotab Drive");
    const drivers=await app.api.mobile.user.get();
    const list=Array.isArray(drivers)?drivers:[drivers];
    const current=list.find(driver=>driver&&driver.id&&driver.id!=="UnknownDriverId"&&driver.id!=="NoDriverId");
    if(current)return current;
    throw new Error("No hay un conductor conectado en esta sesión de Geotab Drive");
  }

  async function loadTasks(){if(!app.user||!app.user.id)return;setConnection("","Actualizando solicitudes…");const result=await getJson({action:"driverTasks",driverId:app.user.id});if(!result.success)throw new Error(result.message||"No se pudieron leer las solicitudes");app.tasks=result.tasks||[];renderTasks();if(app.selected){const fresh=app.tasks.find(task=>task.requestId===app.selected.requestId);if(fresh){app.selected=fresh;renderDetail(fresh);}}setConnection("online","Conectado");}

  function renderTasks(){const list=$("task-list");list.replaceChildren();if(!app.tasks.length){list.innerHTML='<div class="empty">No tiene alertas pendientes de Monitoreo.</div>';return;}app.tasks.forEach(task=>{const button=document.createElement("button");button.type="button";button.className="task-button";const row=document.createElement("div");row.className="row";const title=document.createElement("strong");title.textContent=task.ruleName||"Evento de seguridad";const badge=document.createElement("span");badge.className=`badge${task.status==="RESPONDIDA"?" answered":""}`;badge.textContent=task.status;row.append(title,badge);const plate=document.createElement("p");plate.textContent=task.plate||"Vehículo";const date=document.createElement("small");date.textContent=formatDate(task.activeFrom||task.sentAt);button.append(row,plate,date);button.addEventListener("click",()=>openTask(task));list.appendChild(button);});}

  async function openTask(task){app.selected=task;$("task-list").hidden=true;$("task-detail").hidden=false;renderDetail(task);if(task.status==="ENVIADA"){try{await post("markDriverRequestViewed",{requestId:task.requestId,driverId:app.user.id});task.status="VISTA";renderDetail(task);}catch(error){console.error(error);}}}

  function renderDetail(task){$("task-rule").textContent=task.ruleName||"Evento de seguridad";$("task-plate").textContent=task.plate||"—";$("task-date").textContent=formatDate(task.activeFrom);$("task-value").textContent=task.detectedValue||"—";$("task-zone").textContent=task.zone||"—";$("task-message").textContent=task.message;$("task-sender").textContent=`Enviado por ${task.sentByName||"Monitoreo"} · ${formatDate(task.sentAt)}`;$("task-status").textContent=task.status;$("task-status").className=`badge${task.status==="RESPONDIDA"?" answered":""}`;const answered=task.status==="RESPONDIDA";$("response-form").hidden=answered;$("already-answered").hidden=!answered;if(answered){const response=task.response||{};$("already-answered").textContent=`Respuesta enviada: ${responseLabel(response.responseType)}${response.comment?` — ${response.comment}`:""}`;}}

  async function submitResponse(event){event.preventDefault();if(!app.selected)throw new Error("Seleccione una solicitud");const type=new FormData(event.currentTarget).get("responseType"),comment=$("comment").value.trim();if(!type||!comment)throw new Error("Seleccione una respuesta y escriba su descargo");busy(true);try{await post("submitDriverResponse",{requestId:app.selected.requestId,driverId:app.user.id,driverName:displayName(app.user),responseType:type,comment});toast("Respuesta enviada a Monitoreo");await loadTasks();}finally{busy(false);}}

  async function post(action,values){const operationId=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;const body=new URLSearchParams({action,operationId});Object.entries(values).forEach(([key,value])=>body.append(key,String(value==null?"":value)));await fetch(BACKEND,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});for(let i=0;i<20;i++){await wait(500);const result=await getJson({action:"operationStatus",operationId});if(!result.pending){if(!result.success)throw new Error(result.message||"Operación rechazada");return result;}}throw new Error("No se confirmó el envío");}
  async function getJson(params){const url=new URL(BACKEND);Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,String(value)));url.searchParams.set("_",Date.now());const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error(`Backend ${response.status}`);return response.json();}
  function displayName(user){return(`${user.firstName||""} ${user.lastName||""}`.trim()||user.name||user.id).toUpperCase();}function responseLabel(value){return({RECONOZCO:"Reconozco el evento",JUSTIFICADO:"Evento justificado",NO_RECONOZCO:"No reconozco el evento",EMERGENCIA:"Emergencia"})[value]||value||"Registrada";}function formatDate(value){return value?new Date(value).toLocaleString("es-PE"):"—";}function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}function withTimeout(promise,ms,message){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),ms))]);}
  function setConnection(type,text){$("connection").className=`connection ${type}`;$("connection").textContent=text;}function toast(message,error){const node=$("toast");node.textContent=message;node.className=`toast${error?" error":""}`;node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.hidden=true,4000);}function busy(on){const button=$("submit-response");button.disabled=on;button.textContent=on?"Enviando…":"Enviar respuesta";}function startPolling(){clearInterval(app.timer);app.timer=setInterval(()=>loadTasks().catch(console.error),15000);}
  $("reload").addEventListener("click",()=>loadTasks().catch(error=>toast(error.message,true)));$("back").addEventListener("click",()=>{$("task-detail").hidden=true;$("task-list").hidden=false;app.selected=null;});$("response-form").addEventListener("submit",event=>submitResponse(event).catch(error=>toast(error.message,true)));
  if(window.geotab&&geotab.addin)geotab.addin.ArdepeConductorPrueba=()=>({initialize(api,state,callback){initialize(api,callback);},focus(){if(app.user)loadTasks().catch(console.error);},blur(){}});else setConnection("","Esperando Geotab Drive");
})();
