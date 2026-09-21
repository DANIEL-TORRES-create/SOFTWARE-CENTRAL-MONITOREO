/* ARDEPE - Compatibilidad con navegadores y WebView antiguos.
   Este archivo no cambia nada si el navegador ya soporta estas funciones:
   solo agrega lo que falte, antes de que se carguen los demás scripts. */
(function () {
  'use strict';

  // crypto.randomUUID (usado por services.js para identificar cada operación)
  if (!window.crypto) { window.crypto = {}; }
  if (typeof window.crypto.randomUUID !== 'function') {
    window.crypto.randomUUID = function () {
      var bytes, i;
      if (window.crypto.getRandomValues) {
        bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
      } else {
        bytes = [];
        for (i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 256));
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      var hex = [];
      for (i = 0; i < 256; i++) hex.push((i < 16 ? '0' : '') + i.toString(16));
      var out = '';
      for (i = 0; i < 16; i++) {
        out += hex[bytes[i]];
        if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
      }
      return out;
    };
  }

  // Object.hasOwn (usado por services.js al armar los parámetros de cada solicitud)
  if (typeof Object.hasOwn !== 'function') {
    Object.hasOwn = function (obj, prop) {
      return Object.prototype.hasOwnProperty.call(obj, prop);
    };
  }

  // AbortSignal.timeout (usado por services.js para limitar la espera de cada solicitud).
  // Solo se agrega si AbortController ya existe; si el navegador no lo tiene en absoluto,
  // esta compatibilidad no alcanza y el módulo mostrará el aviso de abajo.
  if (typeof AbortController === 'function' && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
    AbortSignal.timeout = function (ms) {
      var controller = new AbortController();
      setTimeout(function () { controller.abort(); }, ms);
      return controller.signal;
    };
  }

  // Aviso visible si el navegador no puede mostrar los formularios (<dialog> con showModal),
  // o si falta alguna base indispensable que esta compatibilidad no puede suplir.
  function dialogSupported() {
    try {
      var probe = document.createElement('dialog');
      return typeof probe.showModal === 'function';
    } catch (e) { return false; }
  }
  function baseSupported() {
    return typeof window.fetch === 'function' && typeof window.Promise === 'function' &&
      typeof window.crypto.randomUUID === 'function' && typeof AbortController === 'function';
  }
  if (!dialogSupported() || !baseSupported()) {
    if (document.addEventListener) {
      document.addEventListener('DOMContentLoaded', function () {
        var banner = document.createElement('div');
        banner.textContent = 'Este navegador es muy antiguo para mostrar ARDEPE correctamente. Actualice Geotab Drive o el navegador del sistema (Android System WebView) e intente de nuevo.';
        banner.style.position = 'fixed';
        banner.style.top = '0';
        banner.style.left = '0';
        banner.style.right = '0';
        banner.style.zIndex = '99999';
        banner.style.background = '#a72e26';
        banner.style.color = '#fff';
        banner.style.padding = '12px 16px';
        banner.style.fontFamily = 'Arial, sans-serif';
        banner.style.fontSize = '14px';
        banner.style.textAlign = 'center';
        if (document.body) document.body.appendChild(banner);
      });
    }
  }
})();
