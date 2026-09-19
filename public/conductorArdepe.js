(function () {
  const app = new window.ArdepeUI('driver');
  if (window.geotab && window.geotab.addin) window.geotab.addin.conductorArdepe = () => ({
    startup(api, state, callback) { return app.startup(api, state, callback); },
    initialize(api, state, callback) { app.mount(api); callback(); }, focus() { app.resume(); }, blur() { app.pause(); }
  });
  else app.mount(null);
})();
