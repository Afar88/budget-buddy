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
    return { status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json() };
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

// Mock Resend-compatible email API. Captures messages without sending real email.
async function mockEmail() {
  const http = require('node:http');
  const messages = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer email-test-key') {
        res.writeHead(401); return res.end('{"error":"unauthorized"}');
      }
      messages.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"email-test"}');
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    srv, messages, url: `http://127.0.0.1:${srv.address().port}`,
  })));
}

// Minimal Upstash-style Redis REST mock: POST / with ["GET", key] or ["SET", key, value].
function mockRedis() {
  const http = require('node:http');
  const data = new Map();
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer redis-token') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
      const [cmd, key, value, ...options] = JSON.parse(raw);
      let result = null;
      if (cmd === 'GET') result = data.has(key) ? data.get(key) : null;
      else if (cmd === 'SET') {
        if (options.includes('NX') && data.has(key)) result = null;
        else { data.set(key, value); result = 'OK'; }
      } else if (cmd === 'EVAL' && String(key).includes('INCR')) {
        const rateKey = options[0];
        const windowMs = Number(options[1]);
        const count = Number(data.get(rateKey) || 0) + 1;
        data.set(rateKey, count);
        result = [count, windowMs];
      } else if (cmd === 'EVAL') {
        const lockKey = options[0];
        const token = options[1];
        if (data.get(lockKey) === token) { data.delete(lockKey); result = 1; }
        else result = 0;
      }
      const respond = () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ result }));
      };
      // Keep lock acquisition in flight briefly so integration tests can exercise contention.
      if (cmd === 'SET' && key.endsWith(':write-lock') && result === 'OK') setTimeout(respond, 60);
      else respond();
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

test('email verification and password recovery protect self-service accounts', async () => {
  const o = await mock.start();
  const mail = await mockEmail();
  const app = await boot({
    OTARI_BASE_URL: o.url, OTARI_API_KEY: 'app-key',
    RESEND_API_KEY: 'email-test-key', RESEND_API_URL: mail.url + '/emails',
    EMAIL_FROM: 'Budget Buddy <hello@example.test>', APP_BASE_URL: 'https://budget-buddy.test',
  });
  try {
    const signup = await app.call('a', 'POST', '/api/admin/signup', {
      groupName: 'Okafors', email: 'A@x.com', password: 'longpass1',
    });
    assert.equal(signup.status, 201);
    assert.equal(signup.body.verificationRequired, true);
    assert.equal(mail.messages.length, 1);
    const verifyToken = new URL(mail.messages[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get('verify');
    assert.ok(verifyToken);
    assert.equal((await app.call('a', 'POST', '/api/admin/login', { email: 'a@x.com', password: 'longpass1' })).status, 403);
    assert.equal((await app.call('verify', 'POST', '/api/admin/verify-email', { token: verifyToken })).status, 200);
    assert.equal((await app.call('verify-again', 'POST', '/api/admin/verify-email', { token: verifyToken })).status, 400);

    assert.equal((await app.call('a2', 'POST', '/api/admin/signup', { groupName: 'Dup', email: 'a@x.com', password: 'longpass1' })).status, 409);
    assert.equal((await app.call('b', 'POST', '/api/admin/signup', { groupName: 'Year 6B', email: 'b@x.com', password: 'short' })).status, 400);
    const login = await app.call('a', 'POST', '/api/admin/login', { email: 'a@x.com', password: 'longpass1' });
    assert.equal(login.status, 200);
    const member = await app.call('a', 'POST', '/api/admin/members', { name: 'Ada', weeklyCapUsd: 0.5 });
    assert.equal(member.status, 201);

    const forgot = await app.call('forgot', 'POST', '/api/admin/forgot-password', { email: 'a@x.com' });
    assert.equal(forgot.status, 200);
    assert.match(forgot.body.message, /If an account exists/);
    const resetMail = mail.messages[mail.messages.length - 1];
    const resetToken = new URL(resetMail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('reset');
    assert.ok(resetToken);
    assert.equal((await app.call('reset', 'POST', '/api/admin/reset-password', { token: resetToken, password: 'newpass123' })).status, 200);
    assert.equal((await app.call('reset-again', 'POST', '/api/admin/reset-password', { token: resetToken, password: 'anotherpass' })).status, 400);
    assert.equal((await app.call('old-login', 'POST', '/api/admin/login', { email: 'a@x.com', password: 'longpass1' })).status, 401);
    assert.equal((await app.call('new-login', 'POST', '/api/admin/login', { email: 'a@x.com', password: 'newpass123' })).status, 200);
    assert.equal((await app.call('a', 'GET', '/api/admin/members')).status, 401, 'password reset invalidates earlier admin sessions');

    const unknown = await app.call('unknown', 'POST', '/api/admin/forgot-password', { email: 'nobody@example.com' });
    assert.equal(unknown.status, 200);
    assert.equal(mail.messages.length, 2, 'unknown addresses do not trigger email delivery');
  } finally {
    app.stop(); o.srv.close(); mail.srv.close();
  }
});

test('authentication endpoints throttle repeated attempts', async () => {
  const o = await mock.start();
  const app = await boot({ OTARI_BASE_URL: o.url, OTARI_API_KEY: 'app-key' });
  try {
    for (let i = 0; i < 10; i++) {
      assert.equal((await app.call('bad-admin', 'POST', '/api/admin/login', { email: 'nobody@example.com', password: 'wrongpass' })).status, 401);
    }
    const blockedAdmin = await app.call('bad-admin', 'POST', '/api/admin/login', { email: 'nobody@example.com', password: 'wrongpass' });
    assert.equal(blockedAdmin.status, 429);
    assert.ok(Number(blockedAdmin.retryAfter) > 0, 'rate limit includes Retry-After');

    for (let i = 0; i < 60; i++) {
      assert.equal((await app.call('bad-member', 'POST', '/api/member/login', { code: 'XXXXXX' })).status, 401);
    }
    assert.equal((await app.call('bad-member', 'POST', '/api/member/login', { code: 'XXXXXX' })).status, 429);
  } finally { app.stop(); o.srv.close(); }
});

test('Redis auth throttling is shared across separate Vercel instances', async () => {
  const o = await mock.start();
  const r = await mockRedis();
  const env = { OTARI_BASE_URL: o.url, OTARI_API_KEY: 'app-key', KV_REST_API_URL: r.url, KV_REST_API_TOKEN: 'redis-token' };
  const a = await boot(env);
  const b = await boot(env);
  try {
    for (let i = 0; i < 10; i++) {
      const app = i % 2 ? a : b;
      const result = await app.call('attacker-' + i, 'POST', '/api/admin/login', { email: 'nobody@example.com', password: 'wrongpass' });
      assert.equal(result.status, 401);
    }
    const blocked = await b.call('attacker-final', 'POST', '/api/admin/login', { email: 'nobody@example.com', password: 'wrongpass' });
    assert.equal(blocked.status, 429, 'the shared Redis counter blocks attempts across instances');
    assert.ok(Number(blocked.retryAfter) > 0);
  } finally { a.stop(); b.stop(); o.srv.close(); r.srv.close(); }
});

test('Redis write lock prevents concurrent Vercel instances from overwriting shared state', async () => {
  const o = await mock.start();
  const r = await mockRedis();
  const mail = await mockEmail();
  const env = {
    OTARI_BASE_URL: o.url, OTARI_API_KEY: 'app-key',
    KV_REST_API_URL: r.url, KV_REST_API_TOKEN: 'redis-token',
    RESEND_API_KEY: 'email-test-key', RESEND_API_URL: mail.url + '/emails',
    EMAIL_FROM: 'Budget Buddy <hello@example.test>', APP_BASE_URL: 'https://budget-buddy.test',
  };
  const a = await boot(env);
  const b = await boot(env);
  try {
    const results = await Promise.all([
      a.call('signup-a', 'POST', '/api/admin/signup', { groupName: 'Group A', email: 'a@example.com', password: 'password-a' }),
      b.call('signup-b', 'POST', '/api/admin/signup', { groupName: 'Group B', email: 'b@example.com', password: 'password-b' }),
    ]);
    assert.deepEqual(results.map((x) => x.status).sort(), [201, 503], 'one writer succeeds while the competing writer is asked to retry');
    assert.ok(results.find((x) => x.status === 503).retryAfter, 'busy response includes Retry-After');
    assert.ok(r.data.get('budget-buddy:db'), 'successful writer persisted shared state');
  } finally {
    a.stop(); b.stop(); o.srv.close(); r.srv.close(); mail.srv.close();
  }
});


test('Sendliberty domain-free Gmail relay sends verification and password reset messages', async () => {
  const o = await mock.start();
  const mail = await mockEmail();
  const app = await boot({
    OTARI_BASE_URL: o.url, OTARI_API_KEY: 'app-key',
    SENDLIBERTY_API_KEY: 'email-test-key', SENDLIBERTY_API_URL: mail.url + '/api/send',
    APP_BASE_URL: 'https://budget-buddy.test',
  });
  try {
    const signup = await app.call('a', 'POST', '/api/admin/signup', {
      groupName: 'Test family', email: 'parent@example.com', password: 'longpass1',
    });
    assert.equal(signup.status, 201);
    assert.equal(mail.messages.length, 1);
    assert.equal(mail.messages[0].to, 'parent@example.com');
    assert.match(mail.messages[0].subject, /Verify your Budget Buddy email/);
    const verifyToken = new URL(mail.messages[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get('verify');
    assert.ok(verifyToken);
    assert.equal((await app.call('verify', 'POST', '/api/admin/verify-email', { token: verifyToken })).status, 200);

    await app.call('forgot', 'POST', '/api/admin/forgot-password', { email: 'parent@example.com' });
    assert.equal(mail.messages.length, 2);
    assert.match(mail.messages[1].subject, /Reset your Budget Buddy password/);
    assert.equal(new URL(mail.messages[1].text.match(/https?:\/\/\S+/)[0]).searchParams.has('reset'), true);
  } finally {
    app.stop(); o.srv.close(); mail.srv.close();
  }
});
