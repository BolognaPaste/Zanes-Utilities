'use strict';
// Runs the real chat HTTP server on a scratch hub. The history endpoint's only use for this._user() is as its sign-in
// check, so these tests keep that call from being removed as dead code.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ChatHub, HOST } = require('../../chat-core');
const { ChatServer } = require('../../chat-server');

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zu-chat-srv-'));
  const hub = new ChatHub(path.join(dir, 'state.json'));
  const server = new ChatServer(hub);
  await server.start(0, false);
  t.after(() => {
    server.stop();
    hub.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { hub, base: 'http://127.0.0.1:' + server.srv.address().port };
}

async function history(base, auth) {
  const res = await fetch(base + '/api/history?ch=general', { headers: auth ? { Authorization: auth } : {} });
  return { status: res.status, body: await res.json() };
}

test('chat history refuses requests without a valid sign-in token', async t => {
  const { hub, base } = await startServer(t);
  hub.send(HOST, 'general', 'members only');
  for (const auth of [null, 'Bearer ' + 'ab'.repeat(16), 'Basic YWxpY2U6eA==']) {
    const r = await history(base, auth);
    assert.equal(r.status, 401, 'Authorization: ' + auth);
    assert.deepEqual(r.body, { error: 'Not signed in.' });
  }
});

test('chat history returns the channel to a signed-in user', async t => {
  const { hub, base } = await startServer(t);
  hub.send(HOST, 'general', 'members only');
  const { token } = hub.join({ name: 'Alice' }, '127.0.0.1');
  const r = await history(base, 'Bearer ' + token);
  assert.equal(r.status, 200);
  assert.ok(
    r.body.messages.some(m => m.text === 'members only'),
    'the message is in the history'
  );
});
