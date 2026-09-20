(function () {
  const app = new window.ArdepeUI('central');
  if (window.geotab && window.geotab.addin) window.geotab.addin.centralArdepe = () => ({
    initialize(api, state, callback) { app.state=state;app.mount(api); callback(); }, focus() { app.focus(); }, blur() { app.blur(); }
  });
  else app.mount(null);
})();
