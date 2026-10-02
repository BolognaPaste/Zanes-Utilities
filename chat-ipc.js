// Chat backend for the app window (the "Beta Chat/VoiceChat" page). It owns the one ChatHub (chat-core.js) and the optional
// network server (chat-server.js), and gives the page a small set of requests.
//
// The page is the host: it always chats as "host" and is the only one who can add or delete channels, kick people,
// set the join password or start and stop the network server. Those requests never go over the network at all.
// Every request is checked again in chat-core.js, so the page cannot send anything the rules would refuse.
const fs = require('fs');
const secure = require('./secure-store');
const path = require('path');
const { ChatHub, ChatError, HOST } = require('./chat-core');
const { ChatServer } = require('./chat-server');
const { Tunnel, findBinary, looksRight } = require('./chat-tunnel');
const { RemoteClient } = require('./chat-remote');
const appLock = require('./lock-ipc');

function register(ipc, getWin, { app, dialog }) {
  const dir = path.join(app.getPath('userData'), 'chat');
  const hub = new ChatHub(path.join(dir, 'state.json'));
  const server = new ChatServer(hub, { root: __dirname });
  const tunnel = new Tunnel(() => server.setTunnel(null));

  // Where cloudflared.exe was chosen from (kept in the app's data folder), and the folders it is looked for in.
  const binFile = path.join(dir, 'tunnel.json');
  let picked = '';
  try { const b = JSON.parse(secure.readTextSync(binFile)); if (b && looksRight(b.bin)) picked = b.bin; } catch {}
  const unpacked = __dirname.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1');
  const findBin = () => findBinary(picked, [path.join(unpacked, 'cloudflared'), path.join(process.resourcesPath || '', 'cloudflared'), path.join(app.getPath('userData'), 'cloudflared')]);

  // Live events go to the app window. While the app is locked nothing is pushed to the page; it asks for a fresh
  // copy when it is unlocked (see test-ui.js).
  hub.subscribe(HOST, ev => {
    const w = getWin();
    if (w && !appLock.isLocked()) w.webContents.send('chat:event', ev);
  });

  // Joining somebody else's server from this app (see chat-remote.js). Like the local chat, nothing is pushed to the
  // page while the app is locked; it asks for a fresh copy when it is unlocked.
  const remote = new RemoteClient(ev => {
    const w = getWin();
    if (w && !appLock.isLocked()) w.webContents.send('chat:remoteEvent', ev);
  }, path.join(dir, 'remote.json'));

  const str = v => (typeof v === 'string' ? v : '');
  // Every handler answers { ok: true, v: value } or { ok: false, error: message }.
  const h = (channel, fn) => ipc.handle(channel, async (_e, a) => {
    try { return { ok: true, v: await fn(a && typeof a === 'object' ? a : {}) }; }
    catch (err) { return { ok: false, error: err instanceof ChatError || (err && err.message) ? err.message : 'Something went wrong.' }; }
  });
  const settings = () => ({
    serverName: hub.serverName, hostName: hub.hostName, hasPassword: hub.hasPassword(),
    port: hub.net.port, lan: hub.net.lan, server: server.status(),
    tunnel: Object.assign({ want: hub.net.tunnel, bin: findBin() }, tunnel.status())
  });

  h('chat:snapshot', () => hub.snapshot(HOST));
  h('chat:history', a => hub.history(str(a.ch), Number.isInteger(a.before) ? a.before : undefined));
  h('chat:send', a => ({ id: hub.send(HOST, str(a.ch), a.text) }));
  h('chat:typing', a => { hub.typing(HOST, str(a.ch)); return true; });
  h('chat:delete', a => { hub.remove(HOST, str(a.ch), a.id); return true; });

  h('chat:channelAdd', a => ({ id: hub.addChannel(a.name, a.topic) }));
  h('chat:channelEdit', a => { hub.editChannel(str(a.id), { name: a.name, topic: a.topic }); return true; });
  h('chat:channelDel', a => { hub.deleteChannel(str(a.id)); return true; });
  h('chat:kick', a => { hub.kick(str(a.uid)); return true; });

  h('chat:remoteStatus', () => remote.status());
  h('chat:remoteJoin', async a => { const r = await remote.join(str(a.address), str(a.name), str(a.password)); return Object.assign(remote.status(), r); });
  h('chat:remoteLeave', () => { remote.leave(); return remote.status(); });
  h('chat:remoteSnapshot', () => remote.snapshot());
  h('chat:remoteHistory', a => remote.history(str(a.ch), Number.isInteger(a.before) ? a.before : undefined));
  h('chat:remoteSend', a => remote.send(str(a.ch), a.text));
  h('chat:remoteTyping', a => remote.typing(str(a.ch)));
  h('chat:remoteDelete', a => remote.remove(str(a.ch), a.id));

  h('chat:settings', () => settings());
  h('chat:setSettings', a => {
    if (a.serverName != null) hub.setServerName(a.serverName);
    if (a.hostName != null) hub.setHostName(a.hostName);
    if (a.password === '' && tunnel.state !== 'off') throw new ChatError('Close the internet link before removing the password. The link is public, so it needs one.');
    if (a.password != null) hub.setPassword(a.password);      // an empty string removes the password
    return settings();
  });
  // The internet link. It points at the server on this PC, so the server has to be running, and because the address is
  // public the join password is required (anyone who finds the address can still reach the sign-in page).
  async function openLink() {
    if (!server.running()) throw new ChatError('Start the server first.');
    if (!hub.hasPassword()) throw new ChatError('Set a join password first. The internet link is public, so a password is required.');
    const bin = findBin();
    if (!bin) throw new ChatError('cloudflared was not found. Follow the setup steps below the internet link switch.');
    const url = await tunnel.start(bin, server.port);
    server.setTunnel(url);
  }
  h('chat:serverStart', async a => {
    const port = Number(a.port);
    hub.setNet(port, !!a.lan, !!a.tunnel);
    await server.start(port, !!a.lan);
    // A problem with the link must not undo a working local server; the error is shown from settings().tunnel.
    if (a.tunnel) { try { await openLink(); } catch (e) { if (tunnel.state !== 'error') tunnel.fail(e.message); } }
    return settings();
  });
  h('chat:serverStop', () => { tunnel.stop(); server.stop(); return settings(); });
  h('chat:tunnelStart', async () => {
    try { await openLink(); } catch (e) { if (tunnel.state !== 'error') tunnel.fail(e.message); }
    return settings();
  });
  h('chat:tunnelStop', () => { tunnel.stop(); return settings(); });
  h('chat:tunnelPick', async () => {
    const win = getWin();
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose cloudflared', properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'cloudflared', extensions: ['exe'] }] : []
    });
    if (r.canceled || !r.filePaths[0]) return settings();
    if (!looksRight(r.filePaths[0])) throw new ChatError('That file does not look like cloudflared. Its name should start with "cloudflared".');
    picked = r.filePaths[0];
    secure.writeTextSync(binFile, JSON.stringify({ bin: picked }));
    return settings();
  });

  app.on('before-quit', () => { remote.leave(); tunnel.stop(); server.stop(); hub.flush(); });
}

module.exports = { register };
