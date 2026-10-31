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
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const db = store.load();
if (process.env.GROUP_NAME) db.settings.groupName = process.env.GROUP_NAME;

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  'You are Budget Buddy, a friendly, patient helper for families and classrooms. ' +
    'Answer clearly and kindly at a level a curious 10 to 16 year old can follow, keep answers short, ' +
    'encourage learning (explain, do not just hand over homework answers), and keep everything age-appropriate. ' +
    'If someone seems unsafe or upset, gently suggest talking to a trusted adult.';

console.log(`[otari] mode=${otari.mode} base=${otari.BASE_URL} model=${otari.MODEL}`);

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

const modeLabel = {
  managed: 'Otari: own key + budget per member',
  hosted: 'Otari: shared key, per-member caps',
  off: 'Otari not configured',
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
app.post('/api/admin/login', (req, res) => {
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'Set ADMIN_PASSWORD on the server first' });
  if (!auth.checkPassword(req.body?.password)) return res.status(401).json({ error: 'Wrong password' });
  auth.setCookie(res, 'bb_admin', auth.sign('admin'), 60 * 60 * 12);
  res.json({ ok: true });
});

app.get('/api/admin/members', auth.requireAdmin, async (req, res) => {
  const members = await Promise.all(db.members.map((m) => publicMember(m, { forAdmin: true })));
  res.json({ mode: otari.mode, modeLabel, members });
});

const validCap = (cap) => Number.isFinite(cap) && cap >= 0.01 && cap <= 100;

app.post('/api/admin/members', auth.requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const cap = Math.round(Number(req.body?.weeklyCapUsd) * 100) / 100;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!validCap(cap)) return res.status(400).json({ error: 'Weekly cap must be between $0.01 and $100' });
  const member = { id: store.newId(), name, code: store.newJoinCode(), weeklyCapUsd: cap, createdAt: Date.now() };
  if (otari.mode === 'managed') {
    try {
      member.otari = await otari.provisionMember({ memberId: member.id, name, weeklyCapUsd: cap });
    } catch (e) {
      return res.status(502).json({ error: `Otari could not create the key: ${e.message}` });
    }
  }
  db.members.push(member);
  store.save();
  res.status(201).json({ member: await publicMember(member, { forAdmin: true }) });
});

app.patch('/api/admin/members/:id', auth.requireAdmin, async (req, res) => {
  const m = findMember(req.params.id);
  if (!m) return res.status(404).json({ error: 'No such member' });
  try {
    if (req.body?.weeklyCapUsd !== undefined) {
      const cap = Math.round(Number(req.body.weeklyCapUsd) * 100) / 100;
      if (!validCap(cap)) return res.status(400).json({ error: 'Weekly cap must be between $0.01 and $100' });
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
  store.save();
  res.json({ member: await publicMember(m, { forAdmin: true }) });
});

app.post('/api/admin/members/:id/rotate', auth.requireAdmin, async (req, res) => {
  const m = findMember(req.params.id);
  if (!m?.otari?.keyId) return res.status(400).json({ error: 'This member has no own Otari key to rotate' });
  try {
    Object.assign(m.otari, await otari.rotateKey(m.otari.keyId));
  } catch (e) {
    return res.status(502).json({ error: `Otari rotate failed: ${e.message}` });
  }
  store.save();
  res.json({ member: await publicMember(m, { forAdmin: true }) });
});

app.delete('/api/admin/members/:id', auth.requireAdmin, async (req, res) => {
  const m = findMember(req.params.id);
  if (!m) return res.status(404).json({ error: 'No such member' });
  if (m.otari) await otari.deprovision(m.otari);
  db.members = db.members.filter((x) => x.id !== m.id);
  store.save();
  res.json({ ok: true });
});

// ---------- member ----------
app.post('/api/member/login', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const m = db.members.find((x) => x.code === code);
  if (!m) return res.status(401).json({ error: 'That code did not match anyone' });
  auth.setCookie(res, 'bb_member', auth.sign('member:' + m.id));
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const m = findMember(auth.memberIdFrom(req));
  if (!m) return res.status(401).json({ error: 'Sign in with your code' });
  res.json({ member: await publicMember(m) });
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
    store.save();
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
