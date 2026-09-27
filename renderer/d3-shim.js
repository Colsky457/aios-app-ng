/* d3 shim — vendored UMD builds merged into one `window.d3` namespace.
   The renderer is CommonJS; d3 ships ESM-only. The `dist/*.js` files are UMD
   wrappers that attach to `global.d3_<name>`, so load them in dependency order
   and fold each into the single namespace the map script reads. No CDN, no
   eval, no external fetch — every byte is local.

   The individual `d3-<name>/dist/*.js` wrappers each test `typeof exports ===
   'object'` first and, because the sandboxed Electron renderer injects
   `module`/`exports`, take the CommonJS branch and call `require(...)` — which
   throws. So they are NOT used. Instead this loads the single umbrella
   `d3/dist/d3.js`, which is a self-contained UMD bundle with zero requires
   that writes straight into `global.d3`. One script, one namespace, nothing
   to fold. */
(function () {
  const out = (window.d3 = window.d3 || {});
  const s = document.createElement('script');
  s.src = '../node_modules/d3/dist/d3.js';
  s.onload = () => {
    console.error('[d3-shim] d3.js loaded. select=' + typeof (window.d3 && window.d3.select) + ' zoom=' + typeof (window.d3 && window.d3.zoom) + ' keys=' + (window.d3 ? Object.keys(window.d3).slice(0, 6).join(',') : 'none'));
    window.dispatchEvent(new Event('d3:ready'));
  };
  s.onerror = () => {
    console.error('[d3-shim] d3.js failed to load. d3=' + (window.d3 ? Object.keys(window.d3).slice(0, 6).join(',') : 'none'));
    // last-resort safety net: re-check on a timer in case the events misfire
    const probe = setInterval(() => {
      if (typeof window.d3 === 'object' && typeof window.d3.select === 'function') {
        clearInterval(probe); window.dispatchEvent(new Event('d3:ready'));
      }
    }, 200);
    setTimeout(() => { clearInterval(probe); }, 8000);
  };
  document.head.appendChild(s);
  // safety net for the common case: the file loads fine but `load` never fires
  const probe = setInterval(() => {
    if (typeof window.d3 === 'object' && typeof window.d3.select === 'function') {
      clearInterval(probe); window.dispatchEvent(new Event('d3:ready'));
    }
  }, 200);
  setTimeout(() => { clearInterval(probe); }, 8000);
})();