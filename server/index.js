// Budget Buddy server: Express + Otari.
try {
  process.loadEnvFile(); // reads .env if present (Node 20.12+/21.7+)
} catch {}
const path = require('path');
const express = require('express');
const store = require('./store');
const auth = require('./auth');
const otari = require('./otari');
const { weekStart, nextReset } = require('./week');

const app = express();
// Vercel sits behind a trusted proxy; use its forwarded client IP for per-instance throttling.
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const db = store.db; // refreshed in place by store.load() before every API request

// Serialize every state-changing request before loading the shared JSON document.
// This prevents two Vercel instances from reading the same snapshot and overwriting each
// other's writes. Chat requests are included because they append to the shared usage ledger.
// Login/logout endpoints do not mutate persisted state and remain concurrent.
app.use('/api', async (req, res, next) => {
  let lock = null;
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
    !['/admin/login', '/member/login', '/logout'].includes(req.path);
  try {
    if (mutating) {
      lock = await store.acquireWriteLock();
      if (!lock) {
        res.setHeader('Retry-After', '2');
        return res.status(503).json({ error: 'Another update is being saved. Please try again in a moment.' });
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        store.releaseWriteLock(lock).catch((e) => console.error('[store] lock release failed:', e.message));
      };
      res.once('finish', release);
      res.once('close', release);
    }
    await store.load();
    if (process.env.GROUP_NAME) db.settings.groupName = process.env.GROUP_NAME;
    next();
  } catch (e) {
    if (lock) await store.releaseWriteLock(lock).catch(() => {});
    console.error('[store]', e.message);
    res.status(503).json({ error: 'Storage is not reachable right now. Try again in a moment.' });
  }
});

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  'You are Budget Buddy, a friendly, patient helper for families and classrooms. ' +
    'Answer clearly and kindly at a level a curious 10 to 16 year old can follow, keep answers short, ' +
    'encourage learning (explain, do not just hand over homework answers), and keep everything age-appropriate. ' +
    'If someone seems unsafe or upset, gently suggest talking to a trusted adult.';

console.log(`[otari] mode=${otari.mode} base=${otari.BASE_URL} model=${otari.MODEL} store=${store.backend}`);

// ---------- usage ----------
function ledgerFor(memberId) {
  const since = weekStart().getTime();
  return db.ledger.filter((e) => e.memberId === memberId && e.ts >= since);
}

const userCache = new Map(); // otari user id -> { at, data }
async function otariUser(userId) {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < 3000) return hit.data;
  const data = await otari.getUser(userId);
  userCache.set(userId, { at: Date.now(), data });
  return data;
}

// Live usage for one member. In managed mode the numbers come straight from Otari's
// per-user budget counters; otherwise from the per-request costs Otari returned.
async function usageFor(m) {
  const local = ledgerFor(m.id);
  const localSpend = local.reduce((s, e) => s + (e.costUsd || 0), 0);
  if (otari.mode === 'managed' && m.otari?.userId) {
    try {
      const u = await otariUser(m.otari.userId);
      return {
        spentUsd: Number(u.spend || 0) + Number(u.reserved || 0),
        requests: u.current_requests ?? local.length,
        resetsAt: u.next_budget_reset_at || nextReset().toISOString(),
        source: 'live from Otari',
      };
    } catch (e) {
      console.warn('[otari] usage read failed', e.status, e.message);
    }
  }
  return { spentUsd: localSpend, requests: local.length, resetsAt: nextReset().toISOString(), source: 'from Otari costs' };
}

async function publicMember(m, { forAdmin = false } = {}) {
  const u = await usageFor(m);
  const out = {
    id: m.id,
    name: m.name,
    weeklyCapUsd: m.weeklyCapUsd,
    paused: !!m.paused,
    aiStatus: m.paused ? 'paused' : otari.mode === 'off' ? 'not_configured' : 'ready',
    spentUsd: u.spentUsd,
    requests: u.requests,
    resetsAt: u.resetsAt,
  };
  if (forAdmin) {
    out.code = m.code;
    out.source = u.source;
    out.canRotate = !!m.otari?.keyId;
    out.keyLabel = m.otari?.keySuffix ? `Own key …${m.otari.keySuffix}` : otari.mode === 'hosted' ? 'Shared app key, tagged' : 'None';
  }
  return out;
}

const findMember = (id) => db.members.find((m) => m.id === id);
// Members created before sign-up existed belong to the built-in demo group.
const groupOf = (m) => m.groupId || 'demo';
const findGroupMember = (req) => {
  const m = findMember(req.params.id);
  return m && groupOf(m) === req.groupId ? m : null;
};
function groupName(groupId) {
  if (groupId === 'demo') return db.settings.groupName;
  return db.groups.find((g) => g.id === groupId)?.name || 'Your group';
}

// Limits for self-signed-up groups, so open sign-up cannot drain a shared Otari key.
const SIGNUP_MAX_CAP = Number(process.env.SIGNUP_MAX_CAP_USD || 1);
const SIGNUP_MAX_MEMBERS = Number(process.env.SIGNUP_MAX_MEMBERS || 10);
const MAX_GROUPS = Number(process.env.MAX_GROUPS || 500);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const modeLabel = {
  managed: 'Otari: own key + budget per member',
  hosted: 'Otari: shared key, per-member caps',
  off: 'AI service not configured',
}[otari.mode];

// ---------- public ----------
app.get('/api/config', (req, res) => {
  res.json({ groupName: db.settings.groupName, mode: otari.mode, model: otari.MODEL, adminConfigured: !!process.env.ADMIN_PASSWORD });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', [
    'bb_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    'bb_member=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
  ]);
  res.json({ ok: true });
});

// ---------- admin ----------
// Open sign-up: any parent or teacher creates their own private group.
app.post('/api/admin/signup', auth.rateLimit('admin-signup', 5, 15 * 60 * 1000, store), async (req, res) => {
  const name = String(req.body?.groupName || '').trim().slice(0, 40);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
  const password = String(req.body?.password || '');
  if (!name) return res.status(400).json({ error: 'Give your family or class a name' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (db.groups.some((g) => g.email === email)) return res.status(409).json({ error: 'That email already has an account. Sign in instead.' });
  if (db.groups.length >= MAX_GROUPS) return res.status(503).json({ error: 'Sign-ups are full for this demo right now' });
  const group = { id: store.newId(), name, email, pw: auth.hashPassword(password), createdAt: Date.now() };
  db.groups.push(group);
  await store.save();
  auth.setCookie(res, 'bb_admin', auth.sign('admin:' + group.id), 60 * 60 * 12);
  res.status(201).json({ ok: true, groupName: group.name });
});

app.post('/api/admin/login', auth.rateLimit('admin-login', 10, 15 * 60 * 1000, store), (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email) {
    const g = db.groups.find((x) => x.email === email);
    if (!g || !auth.checkHash(req.body?.password, g.pw)) return res.status(401).json({ error: 'Wrong email or password' });
    auth.setCookie(res, 'bb_admin', auth.sign('admin:' + g.id), 60 * 60 * 12);
    return res.json({ ok: true, groupName: g.name });
  }
  if (!process.env.ADMIN_PASSWORD) return res.status(400).json({ error: 'Enter your email and password' });
  if (!auth.checkPassword(req.body?.password)) return res.status(401).json({ error: 'Wrong password' });
  auth.setCookie(res, 'bb_admin', auth.sign('admin'), 60 * 60 * 12);
  res.json({ ok: true, groupName: groupName('demo') });
});

app.get('/api/admin/members', auth.requireAdmin, async (req, res) => {
  const mine = db.members.filter((m) => groupOf(m) === req.groupId);
  const members = await Promise.all(mine.map((m) => publicMember(m, { forAdmin: true })));
  const limits = req.groupId === 'demo' ? null : { maxCapUsd: SIGNUP_MAX_CAP, maxMembers: SIGNUP_MAX_MEMBERS };
  res.json({ mode: otari.mode, modeLabel, groupName: groupName(req.groupId), limits, members });
});

const validCap = (cap) => Number.isFinite(cap) && cap >= 0.01 && cap <= 100;

app.post('/api/admin/members', auth.requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const cap = Math.round(Number(req.body?.weeklyCapUsd) * 100) / 100;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!validCap(cap)) return res.status(400).json({ error: 'Weekly cap must be between $0.01 and $100' });
  if (req.groupId !== 'demo') {
    if (cap > SIGNUP_MAX_CAP) return res.status(400).json({ error: `On this demo the weekly cap is at most $${SIGNUP_MAX_CAP.toFixed(2)}` });
    if (db.members.filter((m) => groupOf(m) === req.groupId).length >= SIGNUP_MAX_MEMBERS)
      return res.status(400).json({ error: `On this demo a group can have up to ${SIGNUP_MAX_MEMBERS} members` });
  }
  let code = store.newJoinCode();
  while (db.members.some((m) => m.code === code)) code = store.newJoinCode();
  const member = { id: store.newId(), groupId: req.groupId, name, code, weeklyCapUsd: cap, createdAt: Date.now() };
  if (otari.mode === 'managed') {
    try {
      member.otari = await otari.provisionMember({ memberId: member.id, name, weeklyCapUsd: cap });
    } catch (e) {
      return res.status(502).json({ error: `Otari could not create the key: ${e.message}` });
    }
  }
  db.members.push(member);
  await store.save();
  res.status(201).json({ member: await publicMember(member, { forAdmin: true }) });
});

app.patch('/api/admin/members/:id', auth.requireAdmin, async (req, res) => {
  const m = findGroupMember(req);
  if (!m) return res.status(404).json({ error: 'No such member' });
  try {
    if (req.body?.weeklyCapUsd !== undefined) {
      const cap = Math.round(Number(req.body.weeklyCapUsd) * 100) / 100;
      if (!validCap(cap)) return res.status(400).json({ error: 'Weekly cap must be between $0.01 and $100' });
      if (req.groupId !== 'demo' && cap > SIGNUP_MAX_CAP)
        return res.status(400).json({ error: `On this demo the weekly cap is at most $${SIGNUP_MAX_CAP.toFixed(2)}` });
      if (m.otari?.budgetId) await otari.setCap(m.otari.budgetId, cap);
      m.weeklyCapUsd = cap;
    }
    if (req.body?.paused !== undefined) {
      const paused = !!req.body.paused;
      if (m.otari?.userId) await otari.setBlocked(m.otari.userId, paused);
      m.paused = paused;
    }
  } catch (e) {
    return res.status(502).json({ error: `Otari update failed: ${e.message}` });
  }
  if (m.otari?.userId) userCache.delete(m.otari.userId);
  await store.save();
  res.json({ member: await publicMember(m, { forAdmin: true }) });
});

app.post('/api/admin/members/:id/rotate', auth.requireAdmin, async (req, res) => {
  const m = findGroupMember(req);
  if (!m) return res.status(404).json({ error: 'No such member' });
  if (!m.otari?.keyId) return res.status(400).json({ error: 'This member has no own Otari key to rotate' });
  try {
    Object.assign(m.otari, await otari.rotateKey(m.otari.keyId));
  } catch (e) {
    return res.status(502).json({ error: `Otari rotate failed: ${e.message}` });
  }
  await store.save();
  res.json({ member: await publicMember(m, { forAdmin: true }) });
});

app.delete('/api/admin/members/:id', auth.requireAdmin, async (req, res) => {
  const m = findGroupMember(req);
  if (!m) return res.status(404).json({ error: 'No such member' });
  if (m.otari) await otari.deprovision(m.otari);
  db.members = db.members.filter((x) => x.id !== m.id);
  await store.save();
  res.json({ ok: true });
});

// ---------- member ----------
app.post('/api/member/login', auth.rateLimit('member-login', 60, 15 * 60 * 1000, store), (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const m = db.members.find((x) => x.code === code);
  if (!m) return res.status(401).json({ error: 'That code did not match anyone' });
  auth.setCookie(res, 'bb_member', auth.sign('member:' + m.id));
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const m = findMember(auth.memberIdFrom(req));
  if (!m) return res.status(401).json({ error: 'Sign in with your code' });
  res.json({ member: await publicMember(m), groupName: groupName(groupOf(m)) });
});

function cleanMessages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string')
    .slice(-12)
    .map((x) => ({ role: x.role, content: x.content.slice(0, 4000) }));
}

app.post('/api/chat', async (req, res) => {
  const m = findMember(auth.memberIdFrom(req));
  if (!m) return res.status(401).json({ error: 'Sign in with your code' });
  if (otari.mode === 'off') return res.status(503).json({ error: 'AI is not set up yet. Ask your grown-up to add an Otari key.' });
  if (m.paused) return res.status(403).json({ error: 'Chat is paused for you right now. Ask your grown-up.' });

  const messages = cleanMessages(req.body?.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Send a message first' });
  }

  // Hosted mode: Budget Buddy is the enforcer, using Otari's own per-request costs.
  if (otari.mode !== 'managed') {
    const u = await usageFor(m);
    if (u.spentUsd >= m.weeklyCapUsd) {
      return res.status(429).json({
        error: "You've used this week's budget. It refills on Monday!",
        member: await publicMember(m),
      });
    }
  }

  try {
    const out = await otari.chat({
      key: m.otari?.key, // managed mode: the member's own virtual key; hosted: the app key
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      tags: { member: m.id, member_name: m.name, group: db.settings.groupName || 'default' },
    });
    db.ledger.push({
      memberId: m.id,
      ts: Date.now(),
      costUsd: out.costUsd || 0,
      tokens: out.tokens,
      model: out.model,
      requestId: out.requestId,
    });
    await store.save();
    if (m.otari?.userId) userCache.delete(m.otari.userId);
    res.json({ reply: out.reply, costUsd: out.costUsd, model: out.model, requestId: out.requestId, member: await publicMember(m) });
  } catch (e) {
    if (e instanceof otari.OtariError && e.isBudget) {
      // Managed mode: Otari refused before calling the model (403 budget_exceeded).
      if (m.otari?.userId) userCache.delete(m.otari.userId);
      return res.status(429).json({
        error: "You've used this week's budget. It refills on Monday!",
        retryAfter: e.retryAfter,
        member: await publicMember(m),
      });
    }
    console.error('[chat]', e.status, e.message);
    res.status(502).json({ error: 'The AI had a hiccup. Try again in a moment.' });
  }
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Budget Buddy on http://localhost:${PORT}`));
}
module.exports = app;
