(function () {
  const app = new window.ArdepeUI('driver');
  if (window.geotab && window.geotab.addin) window.geotab.addin.conductorArdepe = () => ({
    startup(api, state, callback) { return app.startup(api, state, callback); },
    initialize(api, state, callback) { app.state=state;app.mount(api); callback(); }, focus() { app.focus(); }, blur() { app.blur(); }
  });
  else app.mount(null);
})();
