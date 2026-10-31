// End-to-end tests against a mock Otari: `npm test`
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mock = require('./mock-otari');

async function boot(env) {
  const port = 3500 + Math.floor(Math.random() * 400);
  const dataFile = path.join(os.tmpdir(), `bb-${port}-${Date.now()}.json`);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { PATH: process.env.PATH, PORT: String(port), ADMIN_PASSWORD: 'pw', SESSION_SECRET: 's', DATA_FILE: dataFile, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((r) => child.stdout.on('data', (d) => String(d).includes('Budget Buddy on') && r()));
  const jar = {};
  const call = async (who, method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { 'content-type': 'application/json', cookie: jar[who] || '' }, body: body && JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  return { call, stop: () => { child.kill(); fs.rmSync(dataFile, { force: true }); } };
}

test('managed mode: own Otari key + weekly budget per member, Otari enforces cap', async () => {
  const o = await mock.start();
  const app = await boot({ OTARI_BASE_URL: o.url, OTARI_API_KEY: 'app-key', OTARI_ADMIN_KEY: 'admin-key' });
  try {
    assert.equal((await app.call('admin', 'POST', '/api/admin/login', { password: 'pw' })).status, 200);
    const created = await app.call('admin', 'POST', '/api/admin/members', { name: 'Ada', weeklyCapUsd: 0.01 });
    assert.equal(created.status, 201);
    const id = created.body.member.id;
    assert.equal(o.state.budgets[`bb-week-${id}`].reset_alignment, 'calendar_week');
    assert.equal(o.state.users[`bb-${id}`].budget_id, `bb-week-${id}`);
    assert.match(created.body.member.keyLabel, /abcd/);

    assert.equal((await app.call('kid', 'POST', '/api/member/login', { code: created.body.member.code })).status, 200);
    const chat = await app.call('kid', 'POST', '/api/chat', { messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.reply, 'Hello from mock Otari!');
    const last = o.state.calls.filter((c) => c.url.endsWith('/chat/completions')).pop();
    assert.equal(last.auth, 'Bearer tk-member-k0', 'chat must use the member key');
    assert.equal(last.body.metadata.member, id);

    o.state.users[`bb-${id}`].spend = 0.0105; // pretend the week is used up on Otari's side
    const over = await app.call('kid', 'POST', '/api/chat', { messages: [{ role: 'user', content: 'more' }] });
    assert.equal(over.status, 429, 'Otari budget_exceeded becomes a friendly 429');

    const list = await app.call('admin', 'GET', '/api/admin/members');
    assert.equal(list.body.members[0].source, 'live from Otari');
    assert.ok(list.body.members[0].spentUsd >= 0.01);

    await app.call('admin', 'PATCH', `/api/admin/members/${id}`, { weeklyCapUsd: 1, paused: true });
    assert.equal(o.state.budgets[`bb-week-${id}`].max_budget, 1);
    assert.equal(o.state.users[`bb-${id}`].blocked, true);
    const rot = await app.call('admin', 'POST', `/api/admin/members/${id}/rotate`);
    assert.match(rot.body.member.keyLabel, /wxyz/);
    await app.call('admin', 'DELETE', `/api/admin/members/${id}`);
    assert.equal(Object.keys(o.state.keys).length, 0);
    assert.equal(Object.keys(o.state.users).length, 0);
  } finally { app.stop(); o.srv.close(); }
});

test('hosted mode: shared key, tagged requests, app enforces cap from Otari cost', async () => {
  const o = await mock.start();
  const app = await boot({ OTARI_BASE_URL: o.url, OTARI_API_KEY: 'app-key' });
  try {
    await app.call('admin', 'POST', '/api/admin/login', { password: 'pw' });
    const created = await app.call('admin', 'POST', '/api/admin/members', { name: 'Bo', weeklyCapUsd: 0.01 });
    await app.call('kid', 'POST', '/api/member/login', { code: created.body.member.code });
    const chat = await app.call('kid', 'POST', '/api/chat', { messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.costUsd, 0.0012);
    const last = o.state.calls.pop();
    assert.equal(last.auth, 'Bearer app-key');
    assert.equal(last.body.metadata.app, 'budget-buddy');
    for (let i = 0; i < 8; i++) await app.call('kid', 'POST', '/api/chat', { messages: [{ role: 'user', content: 'x' }] });
    const over = await app.call('kid', 'POST', '/api/chat', { messages: [{ role: 'user', content: 'x' }] });
    assert.equal(over.status, 429);
    const list = await app.call('admin', 'GET', '/api/admin/members');
    assert.equal(list.body.members[0].requests, 9);
  } finally { app.stop(); o.srv.close(); }
});

// Minimal Upstash-style Redis REST mock: POST / with ["GET", key] or ["SET", key, value].
function mockRedis() {
  const http = require('node:http');
  const data = new Map();
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer redis-token') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
      const [cmd, key, value] = JSON.parse(raw);
      let result = null;
      if (cmd === 'GET') result = data.has(key) ? data.get(key) : null;
      else if (cmd === 'SET') { data.set(key, value); result = 'OK'; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, data, url: `http://127.0.0.1:${srv.address().port}` })));
}

test('redis store (Vercel/Upstash): state survives a fresh instance', async () => {
  const o = await mock.start();
  const r = await mockRedis();
  const env = { OTARI_BASE_URL: o.url, OTARI_API_KEY: 'app-key', KV_REST_API_URL: r.url, KV_REST_API_TOKEN: 'redis-token' };
  const a = await boot(env);
  let code;
  try {
    await a.call('admin', 'POST', '/api/admin/login', { password: 'pw' });
    const created = await a.call('admin', 'POST', '/api/admin/members', { name: 'Cy', weeklyCapUsd: 0.5 });
    assert.equal(created.status, 201);
    code = created.body.member.code;
    await a.call('kid', 'POST', '/api/member/login', { code });
    assert.equal((await a.call('kid', 'POST', '/api/chat', { messages: [{ role: 'user', content: 'hi' }] })).status, 200);
  } finally { a.stop(); }
  assert.ok(r.data.get('budget-buddy:db'), 'state written to Redis');
  const b = await boot(env); // a brand-new "serverless instance" with no local file
  try {
    await b.call('admin', 'POST', '/api/admin/login', { password: 'pw' });
    const list = await b.call('admin', 'GET', '/api/admin/members');
    assert.equal(list.body.members.length, 1);
    assert.equal(list.body.members[0].code, code);
    assert.equal(list.body.members[0].requests, 1);
  } finally { b.stop(); o.srv.close(); r.srv.close(); }
});
