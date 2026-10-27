try {
  if (window.appLock && window.appLock.startLocked) document.documentElement.classList.add('locked');
} catch (e) {}
