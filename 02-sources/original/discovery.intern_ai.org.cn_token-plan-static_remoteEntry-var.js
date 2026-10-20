
  
  globalThis['token-plan'] = (function () {
    function getScriptUrl() {
      const currentScript = document.currentScript;
      if (!currentScript) {
        console.error("[Module Federation] remoteEntry-var.js script should be called from sync <script> tag (document.currentScript is undefined)")
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
  