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
  nav: what => ipcRenderer.invoke('fmhy:nav', what),
  popup: (url, slot, block) => ipcRenderer.invoke('fmhy:popup', { url, slot, block: block !== false }),
  warm: () => ipcRenderer.invoke('fmhy:warm'),
  adStatus: () => ipcRenderer.invoke('fmhy:adstatus'),
  adSet: on => ipcRenderer.invoke('fmhy:adset', !!on),
  adRefresh: () => ipcRenderer.invoke('fmhy:adrefresh'),
  onAd: on('fmhy:ad')
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

contextBridge.exposeInMainWorld('sshTerm', {
  state: () => ipcRenderer.invoke('ssh:state'),
  pickKey: () => ipcRenderer.invoke('ssh:pickKey'),
  connect: req => ipcRenderer.invoke('ssh:connect', req),
  answer: (pid, answers) => ipcRenderer.invoke('ssh:answer', { pid, answers }),
  input: (id, data) => ipcRenderer.invoke('ssh:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.invoke('ssh:resize', { id, cols, rows }),
  close: id => ipcRenderer.invoke('ssh:close', { id }),
  reset: () => ipcRenderer.invoke('ssh:reset'),
  hosts: () => ipcRenderer.invoke('ssh:hosts'),
  forget: (host, port) => ipcRenderer.invoke('ssh:forget', { host, port }),
  ls: (id, dir) => ipcRenderer.invoke('ssh:ls', { id, dir }),
  mkdir: (id, dir, name) => ipcRenderer.invoke('ssh:mkdir', { id, dir, name }),
  rename: (id, dir, from, to) => ipcRenderer.invoke('ssh:rename', { id, dir, from, to }),
  remove: (id, dir, names) => ipcRenderer.invoke('ssh:rm', { id, dir, names }),
  download: (id, dir, names) => ipcRenderer.invoke('ssh:get', { id, dir, names }),
  upload: (id, dir, kind) => ipcRenderer.invoke('ssh:put', { id, dir, kind }),
  cancelTransfer: id => ipcRenderer.invoke('ssh:xcancel', { id }),
  onEvent: on('ssh:event')
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

contextBridge.exposeInMainWorld('optimizer', {
  specs: () => ipcRenderer.invoke('opt:specs'),
  state: () => ipcRenderer.invoke('opt:state'),
  apply: ids => ipcRenderer.invoke('opt:apply', { ids }),
  undo: () => ipcRenderer.invoke('opt:undo'),
  gpu: paths => ipcRenderer.invoke('opt:gpu', { paths }),
  gpuRemove: path => ipcRenderer.invoke('opt:gpuRemove', { path }),
  gamesGet: () => ipcRenderer.invoke('opt:gamesGet'),
  gamesAdd: paths => ipcRenderer.invoke('opt:gamesAdd', { paths }),
  gamesRemove: path => ipcRenderer.invoke('opt:gamesRemove', { path }),
  gamesApply: (cfg, gpu) => ipcRenderer.invoke('opt:gamesApply', { cfg, gpu }),
  gamesUndo: () => ipcRenderer.invoke('opt:gamesUndo')
});

contextBridge.exposeInMainWorld('chat', {
  snapshot: () => ipcRenderer.invoke('chat:snapshot'),
  history: (ch, before) => ipcRenderer.invoke('chat:history', { ch, before }),
  send: (ch, text) => ipcRenderer.invoke('chat:send', { ch, text }),
  typing: ch => ipcRenderer.invoke('chat:typing', { ch }),
  remove: (ch, id) => ipcRenderer.invoke('chat:delete', { ch, id }),
  channelAdd: (name, topic) => ipcRenderer.invoke('chat:channelAdd', { name, topic }),
  channelEdit: (id, name, topic) => ipcRenderer.invoke('chat:channelEdit', { id, name, topic }),
  channelDel: id => ipcRenderer.invoke('chat:channelDel', { id }),
  kick: uid => ipcRenderer.invoke('chat:kick', { uid }),
  settings: () => ipcRenderer.invoke('chat:settings'),
  setSettings: s => ipcRenderer.invoke('chat:setSettings', s),
  serverStart: (port, lan, tunnel) => ipcRenderer.invoke('chat:serverStart', { port, lan: !!lan, tunnel: !!tunnel }),
  serverStop: () => ipcRenderer.invoke('chat:serverStop'),
  tunnelStart: () => ipcRenderer.invoke('chat:tunnelStart'),
  tunnelStop: () => ipcRenderer.invoke('chat:tunnelStop'),
  tunnelPick: () => ipcRenderer.invoke('chat:tunnelPick'),
  remoteStatus: () => ipcRenderer.invoke('chat:remoteStatus'),
  remoteJoin: (address, name, password) => ipcRenderer.invoke('chat:remoteJoin', { address, name, password }),
  remoteLeave: () => ipcRenderer.invoke('chat:remoteLeave'),
  remoteSnapshot: () => ipcRenderer.invoke('chat:remoteSnapshot'),
  remoteHistory: (ch, before) => ipcRenderer.invoke('chat:remoteHistory', { ch, before }),
  remoteSend: (ch, text) => ipcRenderer.invoke('chat:remoteSend', { ch, text }),
  remoteTyping: ch => ipcRenderer.invoke('chat:remoteTyping', { ch }),
  remoteDelete: (ch, id) => ipcRenderer.invoke('chat:remoteDelete', { ch, id }),
  onRemoteEvent: on('chat:remoteEvent'),
  onEvent: on('chat:event')
});

contextBridge.exposeInMainWorld('mumble', {
  status: () => ipcRenderer.invoke('mumble:status'),
  pick: kind => ipcRenderer.invoke('mumble:pick', { kind }),
  setPassword: password => ipcRenderer.invoke('mumble:setPassword', { password }),
  serverStart: (port, lan, password) => ipcRenderer.invoke('mumble:serverStart', { port, lan: !!lan, password }),
  serverStop: () => ipcRenderer.invoke('mumble:serverStop'),
  setOwnerPassword: password => ipcRenderer.invoke('mumble:setOwnerPassword', { password }),
  open: name => ipcRenderer.invoke('mumble:open', { name })
});


// Encrypted storage for the page's localStorage (secure-ls.js uses this; the data lives in secure-store.js).
contextBridge.exposeInMainWorld('secureStore', {
  load: () => ipcRenderer.sendSync('store:load'),
  importAll: data => ipcRenderer.sendSync('store:import', { data }),
  send: batch => ipcRenderer.send('store:ops', batch),
  status: () => ipcRenderer.invoke('store:status')
});

// App lock. The page asks once, before it is drawn, whether the app starts locked, so nothing flashes up first.
let lockStart = false;
try { const r = ipcRenderer.sendSync('lock:initial'); lockStart = !!(r && r.startLocked); } catch {}
contextBridge.exposeInMainWorld('appLock', {
  startLocked: lockStart,
  state: () => ipcRenderer.invoke('lock:state'),
  set: (password, current) => ipcRenderer.invoke('lock:set', { password, current }),
  remove: password => ipcRenderer.invoke('lock:remove', { password }),
  lock: () => ipcRenderer.invoke('lock:lock'),
  unlock: password => ipcRenderer.invoke('lock:unlock', { password }),
  auto: minutes => ipcRenderer.invoke('lock:auto', { minutes }),
  onChange: on('lock:changed')
});
