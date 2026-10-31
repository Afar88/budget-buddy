// Budget Buddy server (scaffold).
const path = require('path');
const express = require('express');
const store = require('./store');
const auth = require('./auth');
const { weekStart, nextReset } = require('./week');

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const db = store.load();

function weeklySpend(memberId) {
  const since = weekStart().getTime();
  return db.ledger
    .filter((e) => e.memberId === memberId && e.ts >= since)
    .reduce((sum, e) => sum + (e.costUsd || 0), 0);
}

function publicMember(m) {
  const spent = weeklySpend(m.id);
  return {
    id: m.id,
    name: m.name,
    code: m.code,
    weeklyCapUsd: m.weeklyCapUsd,
    paused: !!m.paused,
    spentUsd: spent,
    resetsAt: nextReset().toISOString(),
  };
}

app.get('/api/config', (req, res) => {
  res.json({ groupName: db.settings.groupName, adminConfigured: !!process.env.ADMIN_PASSWORD });
});

// ---- admin ----
app.post('/api/admin/login', (req, res) => {
  if (!auth.checkPassword(req.body?.password)) return res.status(401).json({ error: 'Wrong password' });
  auth.setCookie(res, 'bb_admin', auth.sign('admin'), 60 * 60 * 12);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', [
    'bb_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    'bb_member=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
  ]);
  res.json({ ok: true });
});

app.get('/api/admin/members', auth.requireAdmin, (req, res) => {
  res.json({ members: db.members.map(publicMember) });
});

app.post('/api/admin/members', auth.requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const cap = Number(req.body?.weeklyCapUsd);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!(cap > 0 && cap <= 100)) return res.status(400).json({ error: 'Weekly cap must be between $0.01 and $100' });
  const member = { id: store.newId(), name, code: store.newJoinCode(), weeklyCapUsd: cap, createdAt: Date.now() };
  db.members.push(member);
  store.save();
  res.status(201).json({ member: publicMember(member) });
});

app.delete('/api/admin/members/:id', auth.requireAdmin, (req, res) => {
  db.members = db.members.filter((m) => m.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});

// ---- member ----
app.post('/api/member/login', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const m = db.members.find((x) => x.code === code);
  if (!m) return res.status(401).json({ error: 'That code did not match anyone' });
  auth.setCookie(res, 'bb_member', auth.sign('member:' + m.id));
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const m = db.members.find((x) => x.id === auth.memberIdFrom(req));
  if (!m) return res.status(401).json({ error: 'Sign in with your code' });
  res.json({ member: publicMember(m) });
});

app.post('/api/chat', (req, res) => {
  res.status(501).json({ error: 'AI is not connected yet' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Budget Buddy on http://localhost:${PORT}`));
