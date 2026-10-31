// Otari client for Budget Buddy.
//
// Otari (https://otari.ai, github.com/mozilla-ai/otari) is Mozilla.ai's open-source,
// OpenAI-compatible LLM gateway. Budget Buddy uses it for:
//   * chat:          POST /chat/completions (OpenAI-compatible), with request tags
//   * virtual keys:  POST /keys, POST /keys/{id}/rotate, DELETE /keys/{id}
//   * budgets:       PUT /budgets/{id} with reset_alignment=calendar_week
//   * users:         POST /users (one Otari user per member, attached to its budget),
//                    PATCH /users/{id} {blocked} to pause, GET /users/{id} for live spend
//   * inline cost:   usage.cost_usd on every priced response
//
// Two modes, picked from env:
//   managed  - OTARI_ADMIN_KEY is set (a self-hosted Otari master key, or any token
//              allowed to manage keys/users/budgets). Each member gets a real Otari
//              virtual key + weekly budget; Otari itself enforces the cap.
//   hosted   - only OTARI_API_KEY is set (a normal otari.ai key). On hosted otari.ai a
//              tenant API key cannot call the management routes, so members share the
//              app's key, every request is tagged with the member, and Budget Buddy
//              enforces each weekly cap from Otari's inline per-request cost.

const BASE_URL = (process.env.OTARI_BASE_URL || 'https://api.otari.ai/api/v1').replace(/\/+$/, '');
const API_KEY = process.env.OTARI_API_KEY || '';
const ADMIN_KEY = process.env.OTARI_ADMIN_KEY || '';
const MODEL = process.env.OTARI_MODEL || 'mistralai/mistral-small-3';
const MAX_TOKENS = Number(process.env.OTARI_MAX_TOKENS) || 400;

const mode = ADMIN_KEY ? 'managed' : API_KEY ? 'hosted' : 'off';

// Catch a pasted *masked* key (e.g. "tk-abc••••wxyz") early: HTTP headers must be plain ASCII.
for (const [name, val] of [['OTARI_API_KEY', API_KEY], ['OTARI_ADMIN_KEY', ADMIN_KEY]]) {
  const bad = [...val].findIndex((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 33);
  if (val && bad >= 0) {
    console.error(`[otari] ${name} looks malformed (length ${val.length}, unexpected character at position ${bad}). Paste the full key, not the masked one from the dashboard.`);
  }
}

class OtariError extends Error {
  constructor(status, message, { code, retryAfter, scope } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.scope = scope;
  }
  get isBudget() {
    return this.code === 'budget_exceeded' || /budget/i.test(this.message);
  }
}

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  if (!token) throw new OtariError(500, 'Otari is not configured (set OTARI_API_KEY)');
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const detail = data && (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data));
    throw new OtariError(res.status, detail || `Otari ${res.status}`, {
      code: res.headers.get('otari-error-code') || undefined,
      retryAfter: Number(res.headers.get('retry-after')) || undefined,
      scope: res.headers.get('otari-budget-scope') || undefined,
    });
  }
  return { data, headers: res.headers };
}

// ---------- chat ----------
async function chat({ key, messages, tags = {}, model = MODEL, maxTokens = MAX_TOKENS }) {
  const { data, headers } = await request('/chat/completions', {
    method: 'POST',
    token: key || API_KEY,
    body: {
      model,
      messages,
      max_tokens: maxTokens, // a realistic cap keeps Otari's up-front budget hold small
      metadata: { app: 'budget-buddy', ...tags }, // Otari request tags: filter/group usage by member
    },
  });
  const usage = data.usage || {};
  return {
    reply: data.choices?.[0]?.message?.content ?? '',
    model: headers.get('otari-model') || data.model || model,
    requestId: headers.get('otari-request-id') || data.id,
    costUsd: usage.cost_usd != null ? Number(usage.cost_usd) : null,
    pricingSource: usage.pricing_source || null,
    tokens: usage.total_tokens || 0,
  };
}

// ---------- management (managed mode) ----------
const admin = (path, opts = {}) => request(path, { ...opts, token: ADMIN_KEY });

const ids = (memberId) => ({ userId: `bb-${memberId}`, budgetId: `bb-week-${memberId}` });

async function provisionMember({ memberId, name, weeklyCapUsd }) {
  const { userId, budgetId } = ids(memberId);
  // Weekly budget that resets on the UTC calendar week (Monday 00:00).
  await admin(`/budgets/${budgetId}`, {
    method: 'PUT',
    body: { name: `Budget Buddy: ${name}`, max_budget: weeklyCapUsd, reset_alignment: 'calendar_week' },
  });
  await admin('/users', {
    method: 'POST',
    body: { user_id: userId, alias: name, budget_id: budgetId, metadata: { app: 'budget-buddy' } },
  });
  const { data: key } = await admin('/keys', {
    method: 'POST',
    body: { user_id: userId, key_name: `budget-buddy-${name}`, metadata: { app: 'budget-buddy', member: memberId } },
  });
  return { userId, budgetId, keyId: key.id, key: key.key, keySuffix: key.key_suffix || String(key.key).slice(-4) };
}

async function setCap(budgetId, weeklyCapUsd) {
  await admin(`/budgets/${budgetId}`, { method: 'PATCH', body: { max_budget: weeklyCapUsd } });
}

async function setBlocked(userId, blocked) {
  await admin(`/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { blocked } });
}

async function rotateKey(keyId) {
  const { data } = await admin(`/keys/${keyId}/rotate`, { method: 'POST' });
  return { key: data.key, keySuffix: data.key_suffix || String(data.key).slice(-4) };
}

async function getUser(userId) {
  const { data } = await admin(`/users/${encodeURIComponent(userId)}`);
  return data; // { spend, reserved, current_requests, next_budget_reset_at, blocked, ... }
}

async function deprovision({ userId, budgetId, keyId }) {
  // Best effort: a member removed from Budget Buddy should lose Otari access even if one step fails.
  for (const p of [keyId && `/keys/${keyId}`, userId && `/users/${encodeURIComponent(userId)}`, budgetId && `/budgets/${budgetId}`]) {
    if (!p) continue;
    try {
      await admin(p, { method: 'DELETE' });
    } catch (e) {
      console.warn('[otari] cleanup', p, e.status, e.message);
    }
  }
}

module.exports = {
  mode,
  MODEL,
  BASE_URL,
  OtariError,
  chat,
  provisionMember,
  setCap,
  setBlocked,
  rotateKey,
  getUser,
  deprovision,
};
