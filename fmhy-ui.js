// FMHY page: fmhy.net shown inside the page area, with back / forward / home buttons.
// Talks to fmhy-ipc.js through window.fmhy (see preload.js). Uses $ from index.html.
// The site is drawn by the main process over #fm-host, so this file only reports where that box is.
(function () {
  'use strict';
  const host = $('#fm-host'), na = $('#fm-na'), bar = $('#fm-bar');
  if (!host) return;
  const api = window.fmhy;
  if (!api || !api.show) {
    na.hidden = false; bar.hidden = true; host.hidden = true;
    window.fmEnter = window.fmPause = () => {};
    return;
  }

  let on = false, last = '', timer = 0, ro = null;
  const box = () => {
    const r = host.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const sync = () => {
    if (!on) return;
    const b = box(), k = [b.x, b.y, b.width, b.height].join();
    if (k !== last) { last = k; api.bounds(b); }
  };

  window.fmEnter = () => {
    on = true; last = '';
    requestAnimationFrame(() => {
      if (!on) return;
      const b = box(); last = [b.x, b.y, b.width, b.height].join();
      api.show(b);
    });
    if (window.ResizeObserver && !ro) { ro = new ResizeObserver(sync); ro.observe(host); }
    clearInterval(timer); timer = setInterval(sync, 300);   // also catches the menu opening or closing
  };
  window.fmPause = () => {
    if (!on) return;
    on = false; clearInterval(timer);
    api.hide();
  };

  window.addEventListener('resize', sync);
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-n]');
    if (b) api.nav(b.dataset.n);
  });
})();
