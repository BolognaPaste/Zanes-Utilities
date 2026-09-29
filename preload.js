const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('efs', {
  pickDir: id => ipcRenderer.invoke('efs:pick', id),
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
