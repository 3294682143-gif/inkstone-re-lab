
  var discovery_app;
  discovery_app = (function () {
    function getScriptUrl() {
      const currentScript = document.currentScript;
      if (!currentScript) {
        console.error("[VarRemoteEntry] remoteEntry-var.js script should be called from sync <script> tag (document.currentScript is undefined)")
        return '/';
      }
      return document.currentScript.src.replace(/\/[^/]*$/, '/');
    }

    const entry = "https://static.openxlab.org.cn/discovery-fe/prod/discovery-app-fe/4cbb6628/remoteEntry.js";

    return {
      get: (...args) => import(entry).then(m => m.get(...args)),
      init: (...args) => import(entry).then(m => m.init(...args)),
    };
  })();
  