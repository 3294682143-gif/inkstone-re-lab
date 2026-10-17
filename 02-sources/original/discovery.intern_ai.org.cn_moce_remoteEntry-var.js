
  var discovery_chat;
  discovery_chat = (function () {
    function getScriptUrl() {
      const currentScript = document.currentScript;
      if (!currentScript) {
        console.error("[VarRemoteEntry] remoteEntry-var.js script should be called from sync <script> tag (document.currentScript is undefined)")
        return '/';
      }
      return document.currentScript.src.replace(/\/[^/]*$/, '/');
    }

    const entry = 'https://static.openxlab.org.cn/discovery-fe/prod/discovery-moce-fe/3b8d2b32/remoteEntry.js';

    return {
      get: (...args) => import(entry).then(m => m.get(...args)),
      init: (...args) => import(entry).then(m => m.init(...args)),
    };
  })();
  