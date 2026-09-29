const { contextBridge, ipcRenderer } = require('electron');

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
  onDownload: cb => {
    const h = (_e, m) => cb(m);
    ipcRenderer.on('vnd:progress', h);
    return () => ipcRenderer.removeListener('vnd:progress', h);
  },
  onProgress: cb => {
    const h = (_e, m) => cb(m);
    ipcRenderer.on('drv:progress', h);
    return () => ipcRenderer.removeListener('drv:progress', h);
  }
});

contextBridge.exposeInMainWorld('shredder', {
  pick: kind => ipcRenderer.invoke('shr:pick', kind),
  run: paths => ipcRenderer.invoke('shr:run', { paths }),
  cancel: () => ipcRenderer.invoke('shr:cancel'),
  onProgress: cb => {
    const h = (_e, m) => cb(m);
    ipcRenderer.on('shr:progress', h);
    return () => ipcRenderer.removeListener('shr:progress', h);
  }
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
  onProgress: cb => {
    const h = (_e, m) => cb(m);
    ipcRenderer.on('vlt:progress', h);
    return () => ipcRenderer.removeListener('vlt:progress', h);
  }
});

contextBridge.exposeInMainWorld('localVideos', {
  pick: () => ipcRenderer.invoke('vid:pick'),
  scan: dir => ipcRenderer.invoke('vid:scan', dir),
  open: file => ipcRenderer.invoke('vid:open', file),
  thumb: file => ipcRenderer.invoke('vid:thumb', file),
  fixAudio: file => ipcRenderer.invoke('vid:fixaudio', file),
  cancelFix: () => ipcRenderer.invoke('vid:fixcancel'),
  onFix: cb => {
    const h = (_e, m) => cb(m);
    ipcRenderer.on('vid:progress', h);
    return () => ipcRenderer.removeListener('vid:progress', h);
  }
});
