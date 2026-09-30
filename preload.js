const { contextBridge, ipcRenderer } = require('electron');

// Subscribes to a channel and returns the function that unsubscribes.
const on = channel => cb => {
  const h = (_e, m) => cb(m);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('efs', {
  pickDir: id => ipcRenderer.invoke('efs:pick', id),
  pickExe: () => ipcRenderer.invoke('efs:pickExe'),
  list: p => ipcRenderer.invoke('efs:list', p),
  stat: p => ipcRenderer.invoke('efs:stat', p),
  text: p => ipcRenderer.invoke('efs:text', p)
});

contextBridge.exposeInMainWorld('drivers', {
  scan: () => ipcRenderer.invoke('drv:scan'),
  installed: () => ipcRenderer.invoke('drv:installed'),
  install: (ids, restore) => ipcRenderer.invoke('drv:install', { ids, restore: !!restore }),
  vendors: () => ipcRenderer.invoke('vnd:check'),
  download: url => ipcRenderer.invoke('vnd:download', { url }),
  runInstaller: file => ipcRenderer.invoke('vnd:run', { file }),
  onDownload: on('vnd:progress'),
  onProgress: on('drv:progress')
});

contextBridge.exposeInMainWorld('shredder', {
  pick: kind => ipcRenderer.invoke('shr:pick', kind),
  run: paths => ipcRenderer.invoke('shr:run', { paths }),
  cancel: () => ipcRenderer.invoke('shr:cancel'),
  onProgress: on('shr:progress')
});

contextBridge.exposeInMainWorld('vault', {
  state: () => ipcRenderer.invoke('vlt:state'),
  create: password => ipcRenderer.invoke('vlt:create', { password }),
  pick: () => ipcRenderer.invoke('vlt:pick'),
  open: (file, password) => ipcRenderer.invoke('vlt:open', { file, password }),
  add: kind => ipcRenderer.invoke('vlt:add', { kind }),
  extract: ids => ipcRenderer.invoke('vlt:extract', { ids }),
  remove: ids => ipcRenderer.invoke('vlt:remove', { ids }),
  changePassword: (oldPassword, newPassword) => ipcRenderer.invoke('vlt:passwd', { oldPassword, newPassword }),
  lock: () => ipcRenderer.invoke('vlt:lock'),
  cancel: () => ipcRenderer.invoke('vlt:cancel'),
  onProgress: on('vlt:progress')
});

contextBridge.exposeInMainWorld('webGames', {
  list: (category, adult) => ipcRenderer.invoke('gms:list', { category, adult: !!adult }),
  blockAds: on => ipcRenderer.invoke('gms:ads', !!on),
  coolmath: () => ipcRenderer.invoke('gms:coolmath')
});

contextBridge.exposeInMainWorld('appData', {
  wipe: opts => ipcRenderer.invoke('app:wipe', { audio: !!(opts && opts.audio) })
});

contextBridge.exposeInMainWorld('fmhy', {
  show: bounds => ipcRenderer.invoke('fmhy:show', bounds),
  bounds: bounds => ipcRenderer.invoke('fmhy:bounds', bounds),
  hide: () => ipcRenderer.invoke('fmhy:hide'),
  nav: what => ipcRenderer.invoke('fmhy:nav', what)
});

contextBridge.exposeInMainWorld('phone', {
  status: () => ipcRenderer.invoke('phn:status'),
  devices: () => ipcRenderer.invoke('phn:devices'),
  start: (serial, opts) => ipcRenderer.invoke('phn:start', { serial, opts }),
  stop: () => ipcRenderer.invoke('phn:stop'),
  key: (serial, action) => ipcRenderer.invoke('phn:key', { serial, action }),
  shot: serial => ipcRenderer.invoke('phn:shot', { serial }),
  install: serial => ipcRenderer.invoke('phn:install', { serial }),
  reveal: file => ipcRenderer.invoke('phn:reveal', { file }),
  folder: () => ipcRenderer.invoke('phn:folder'),
  onEvent: on('phn:event')
});

contextBridge.exposeInMainWorld('localVideos', {
  pick: () => ipcRenderer.invoke('vid:pick'),
  scan: dir => ipcRenderer.invoke('vid:scan', dir),
  open: file => ipcRenderer.invoke('vid:open', file),
  thumb: file => ipcRenderer.invoke('vid:thumb', file),
  fixAudio: file => ipcRenderer.invoke('vid:fixaudio', file),
  cancelFix: () => ipcRenderer.invoke('vid:fixcancel'),
  onFix: on('vid:progress')
});
