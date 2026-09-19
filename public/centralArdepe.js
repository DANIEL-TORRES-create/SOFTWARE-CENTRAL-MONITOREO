(function () {
  const app = new window.ArdepeUI('central');
  if (window.geotab && window.geotab.addin) window.geotab.addin.centralArdepe = () => ({
    initialize(api, state, callback) { app.mount(api); callback(); }, focus() { app.resume(); }, blur() { app.pause(); }
  });
  else app.mount(null);
})();
