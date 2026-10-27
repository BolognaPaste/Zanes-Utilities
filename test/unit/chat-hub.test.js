'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ChatHub, ChatError, LIMITS, HOST } = require('../../chat-core');

function makeHub(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zu-chat-'));
  const hub = new ChatHub(path.join(dir, 'state.json'));
  t.after(() => { hub.flush(); fs.rmSync(dir, { recursive: true, force: true }); });
  return hub;
}
const code = fn => { try { fn(); } catch (e) { return e instanceof ChatError ? e.code : 'other:' + e.message; } return null; };

test('a new hub starts with the default channels and the host identity', t => {
  const hub = makeHub(t);
  const snap = hub.snapshot(HOST);
  assert.deepEqual(snap.channels.map(c => c.id), ['general', 'off-topic']);
  assert.equal(snap.me.host, true);
});

test('joining without a password works and returns a usable token', t => {
  const hub = makeHub(t);
  const { token, me } = hub.join({ name: 'Alice' }, '10.0.0.2');
  assert.equal(me.name, 'Alice');
  assert.equal(hub.auth(token).id, me.id);
  assert.equal(hub.auth('short'), null);
});

test('join validates names and rejects duplicates (case-insensitive)', t => {
  const hub = makeHub(t);
  assert.equal(code(() => hub.join({ name: 'A' }, 'x')), 400);
  hub.join({ name: 'Bob' }, 'x');
  assert.equal(code(() => hub.join({ name: 'bob' }, 'y')), 400);
});

test('a server password is required and wrong guesses are rate limited per address', t => {
  const hub = makeHub(t);
  hub.setPassword('hunter22');
  assert.equal(code(() => hub.join({ name: 'Eve', password: 'nope' }, '1.2.3.4')), 403);
  for (let i = 1; i < LIMITS.failMax; i++) code(() => hub.join({ name: 'Eve', password: 'nope' }, '1.2.3.4'));
  assert.equal(code(() => hub.join({ name: 'Eve', password: 'hunter22' }, '1.2.3.4')), 429);
  const ok = hub.join({ name: 'Frank', password: 'hunter22' }, '5.6.7.8');
  assert.ok(ok.token);
});

test('resuming with a token returns the same identity; an unknown token is 401', t => {
  const hub = makeHub(t);
  const { token, me } = hub.join({ name: 'Carol' }, 'x');
  assert.equal(hub.join({ token }).me.id, me.id);
  assert.equal(code(() => hub.join({ token: 'f'.repeat(48) })), 401);
});

test('a recovery code lets a returning person reclaim their identity with a fresh token', t => {
  const hub = makeHub(t);
  const recover = 'a'.repeat(32);
  const first = hub.join({ name: 'Dana', recover }, 'x');
  const second = hub.join({ recover }, 'y');
  assert.equal(second.me.id, first.me.id);
  assert.notEqual(second.token, first.token);
  assert.equal(hub.auth(first.token), null);
});

test('messages are sequenced, trimmed and capped by length', t => {
  const hub = makeHub(t);
  const a = hub.send(HOST, 'general', '  hello  ');
  const b = hub.send(HOST, 'general', 'again');
  assert.equal(b, a + 1);
  assert.equal(hub.history('general').messages[0].text, 'hello');
  assert.equal(code(() => hub.send(HOST, 'general', '   ')), 400);
  assert.equal(code(() => hub.send(HOST, 'general', 'x'.repeat(LIMITS.text + 1))), 400);
  assert.equal(code(() => hub.send(HOST, 'nope', 'hi')), 404);
});

test('non-host people are limited to a burst of messages; the host is not', t => {
  const hub = makeHub(t);
  const { me } = hub.join({ name: 'Spammer' }, 'x');
  for (let i = 0; i < LIMITS.burst; i++) hub.send(me.id, 'general', 'm' + i);
  assert.equal(code(() => hub.send(me.id, 'general', 'too fast')), 429);
  for (let i = 0; i < LIMITS.burst + 3; i++) hub.send(HOST, 'general', 'host ' + i);
});

test('history keeps only the newest messages and pages backwards', t => {
  const hub = makeHub(t);
  for (let i = 0; i < LIMITS.history + 20; i++) hub.send(HOST, 'general', 'n' + i);
  const all = hub.d.messages.general;
  assert.equal(all.length, LIMITS.history);
  assert.equal(all[0].text, 'n20');
  const page = hub.history('general', undefined, 50);
  assert.equal(page.messages.length, 50);
  assert.equal(page.more, true);
  const older = hub.history('general', page.messages[0].id, 50);
  assert.ok(older.messages.every(m => m.id < page.messages[0].id));
});

test('people can delete only their own messages; the host can delete any', t => {
  const hub = makeHub(t);
  const a = hub.join({ name: 'Ann' }, 'x').me.id, b = hub.join({ name: 'Ben' }, 'y').me.id;
  const m = hub.send(a, 'general', 'mine');
  assert.equal(code(() => hub.remove(b, 'general', m)), 403);
  hub.remove(HOST, 'general', m);
  assert.equal(code(() => hub.remove(HOST, 'general', m)), 404);
});

test('control characters and bidi overrides are stripped from names and text', t => {
  const hub = makeHub(t);
  const { me } = hub.join({ name: 'Zed\u202E\u0007 Q' }, 'x');
  assert.equal(me.name, 'Zed Q');
  const id = hub.send(HOST, 'general', 'hi\u200B there\u0000');
  assert.equal(hub.d.messages.general.find(x => x.id === id).text, 'hi there');
});

test('channel rules: unique slug names, at least one channel, delete drops messages', t => {
  const hub = makeHub(t);
  const id = hub.addChannel('Dev Talk!!', 'topic');
  assert.equal(hub.d.channels.find(c => c.id === id).name, 'dev-talk');
  assert.equal(code(() => hub.addChannel('dev talk')), 400);
  hub.send(HOST, id, 'x');
  hub.deleteChannel(id);
  assert.equal(hub.d.messages[id], undefined);
  hub.deleteChannel('general');
  assert.equal(code(() => hub.deleteChannel('off-topic')), 400);
});

test('kick removes the person and invalidates their token', t => {
  const hub = makeHub(t);
  const { token, me } = hub.join({ name: 'Kim' }, 'x');
  hub.kick(me.id);
  assert.equal(hub.auth(token), null);
  assert.equal(code(() => hub.kick(me.id)), 404);
});

test('setNet and setPassword validate their input', t => {
  const hub = makeHub(t);
  assert.equal(code(() => hub.setNet(80, true, false)), 400);
  hub.setNet(9000, true, false);
  assert.deepEqual(hub.net, { port: 9000, lan: true, tunnel: false });
  assert.equal(code(() => hub.setPassword('abc')), 400);
  hub.setPassword('');
  assert.equal(hub.d.pw, null);
});
