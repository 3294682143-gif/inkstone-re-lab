
  var discovery_paper_fe;
  discovery_paper_fe = (function () {
    function getScriptUrl() {
      const currentScript = document.currentScript;
      if (!currentScript) {
        console.error("[VarRemoteEntry] remoteEntry-var.js script should be called from sync <script> tag (document.currentScript is undefined)")
        return '/';
      }
      return document.currentScript.src.replace(/\/[^/]*$/, '/');
    }

    const entry = getScriptUrl() + 'remoteEntry.js';

    return {
      get: (...args) => import(entry).then(m => m.get(...args)),
      init: (...args) => import(entry).then(m => m.init(...args)),
    };
  })();
  