(() => {
  'use strict';

  // Stability-first runtime shim.
  //
  // The previous version replaced window.fetch globally with a queued/cached
  // request coordinator. That made every controller feature depend on one
  // interception layer and could occasionally leave the authenticated page
  // stuck after /controller/status completed. Core controller requests now use
  // the browser's native fetch directly; timeouts and deduplication are handled
  // by each feature where needed.
  //
  // Keep a tiny diagnostics object so the rest of the controller can detect the
  // runtime version without changing browser networking behavior.
  window.__HLLVRuntime = Object.freeze({
    version: 'stability-native-fetch-1',
    nativeFetch: true,
    installedAt: Date.now()
  });
})();
