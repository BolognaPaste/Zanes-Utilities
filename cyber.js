(() => {
  'use strict';
  const home = document.getElementById('p-home');
  const clk = document.getElementById('hud-clk');
  const day = document.getElementById('hud-day');
  if (!home || !clk || !day) return;
  const pad = n => String(n).padStart(2, '0');
  const tick = () => {
    if (home.hidden) return;
    const d = new Date();
    clk.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    day.textContent = d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    clk.parentElement.style.setProperty('--sp', String(d.getSeconds() / 59));
  };
  tick();
  setInterval(tick, 1000);
})();
