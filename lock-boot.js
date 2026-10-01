// Runs first, in the page's <head>, before anything is drawn. If a password is set the app starts locked, so the
// lock screen is switched on right away and none of the app flashes up before lock-ui.js takes over.
// (A separate file because the page's security policy does not allow inline scripts.)
try { if (window.appLock && window.appLock.startLocked) document.documentElement.classList.add('locked'); } catch (e) {}
