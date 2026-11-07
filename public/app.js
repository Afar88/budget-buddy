// Budget Buddy front end: plain JS, no build step.
const $ = (id) => document.getElementById(id);
const views = ['landing', 'admin-login', 'admin-signup', 'admin', 'admin-group', 'chat'];
let pollTimer = null;
let me = null;
let activeView = 'landing';

function closeMenu() {
  $('menu-panel').classList.add('hidden');
  $('menu-toggle').setAttribute('aria-expanded', 'false');
  $('menu-toggle').setAttribute('aria-label', 'Open menu');
}

function show(name) {
  activeView = name;
  views.forEach((v) => $('view-' + v).classList.toggle('hidden', v !== name));
  const signedIn = name === 'admin' || name === 'admin-group' || name === 'chat';
  $('account-menu').classList.toggle('hidden', !signedIn);
  $('menu-heading').textContent = name === 'admin' || name === 'admin-group' ? 'Parent / teacher' : 'Teen account';
  $('menu-budget').classList.toggle('hidden', name !== 'chat');
  $('menu-primary').classList.toggle('hidden', name === 'chat');
  $('menu-primary').textContent = name === 'admin-group' ? 'Back to dashboard' : 'Group dashboard';
  $('menu-secondary').textContent = name === 'admin' || name === 'admin-group' ? 'Refresh members' : 'Clear chat history';
  if (!['admin','admin-group'].includes(name)) clearInterval(pollTimer);
  closeMenu();
}

// Account menu: the parent and member see different actions.
$('menu-toggle').addEventListener('click', () => {
  const opening = $('menu-panel').classList.contains('hidden');
  $('menu-panel').classList.toggle('hidden', !opening);
  $('menu-toggle').setAttribute('aria-expanded', String(opening));
  $('menu-toggle').setAttribute('aria-label', opening ? 'Close menu' : 'Open menu');
});
document.addEventListener('click', (e) => {
  if (!$('account-menu').contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
$('menu-primary').addEventListener('click', () => {
  closeMenu();
  if (activeView === 'admin') show('admin-group');
  else if (activeView === 'admin-group') show('admin');
});
$('menu-secondary').addEventListener('click', async () => {
  closeMenu();
  if (activeView === 'chat') {
    localStorage.removeItem(historyKey());
    renderChat();
  } else {
    const button = $('menu-secondary');
    button.disabled = true;
    try { await refreshMembers(); }
    finally { button.disabled = false; }
  }
});
$('menu-logout').addEventListener('click', async () => {
  closeMenu();
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  me = null;
  show('landing');
});

function setFormBusy(form, busy, busyText) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.idleText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.idleText || button.textContent;
    button.disabled = false;
    form.removeAttribute('aria-busy');
  }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Money: whole cents for normal amounts; down to a millionth of a dollar for tiny AI costs
// (one chat on a small open model is often well under a cent, e.g. $0.000007).
function usd(n) {
  n = Number(n) || 0;
  if (n === 0 || n >= 1) return '$' + n.toFixed(2);
  const s = n.toFixed(6).replace(/0+$/, '');
  const decimals = Math.max(2, s.split('.')[1].length);
  return '$' + n.toFixed(decimals);
}

function meterClass(pct) {
  return pct >= 100 ? 'bad' : pct >= 75 ? 'warn' : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- landing ----------
$('code').addEventListener('input', () => {
  $('code').value = $('code').value.toUpperCase().replace(/[^A-HJ-KM-NP-Z2-9]/g, '').slice(0, 6);
});
$('form-code').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  $('code-error').textContent = '';
  setFormBusy(form, true, 'Joining…');
  try {
    await api('/api/member/login', { method: 'POST', body: { code: $('code').value.trim() } });
    await openChat();
  } catch (err) {
    $('code-error').textContent = err.message;
  } finally {
    setFormBusy(form, false);
  }
});

// ---------- admin ----------
$('form-admin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  $('admin-error').textContent = '';
  setFormBusy(form, true, 'Signing in…');
  try {
    await api('/api/admin/login', { method: 'POST', body: { email: $('admin-email').value, password: $('admin-pass').value } });
    $('admin-pass').value = '';
    openAdmin();
  } catch (err) {
    $('admin-error').textContent = err.message;
  } finally {
    setFormBusy(form, false);
  }
});

$('to-signup').addEventListener('click', () => show('admin-signup'));
$('login-back').addEventListener('click', () => show('landing'));
$('signup-back').addEventListener('click', () => show('landing'));
$('cta-signup').addEventListener('click', () => show('admin-signup'));
$('cta-login').addEventListener('click', () => show('admin-login'));
$('to-login').addEventListener('click', () => show('admin-login'));

$('form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  $('signup-error').textContent = '';
  setFormBusy(form, true, 'Creating account…');
  try {
    await api('/api/admin/signup', {
      method: 'POST',
      body: { groupName: $('su-group').value, email: $('su-email').value, password: $('su-pass').value },
    });
    $('su-pass').value = '';
    openAdmin();
  } catch (err) {
    $('signup-error').textContent = err.message;
  } finally {
    setFormBusy(form, false);
  }
});

$('form-member').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('member-error').textContent = '';
  const btn = e.submitter;
  btn.disabled = true;
  btn.dataset.idleText = btn.textContent;
  btn.textContent = 'Adding…';
  try {
    await api('/api/admin/members', {
      method: 'POST',
      body: { name: $('m-name').value, weeklyCapUsd: Number($('m-cap').value) },
    });
    $('m-name').value = '';
    await refreshMembers();
  } catch (err) {
    $('member-error').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = btn.dataset.idleText || 'Add member';
  }
});

async function openAdmin() {
  show('admin');
  await refreshMembers();
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshMembers, 5000);
}
$('open-group').addEventListener('click', () => show('admin-group'));
$('back-dashboard').addEventListener('click', () => show('admin'));

async function refreshMembers() {
  let data;
  try {
    data = await api('/api/admin/members');
  } catch (err) {
    if (err.status === 401) return show('admin-login');
    $('member-error').textContent = err.message;
    return;
  }
  $('mode-badge').textContent = data.modeLabel || '';
  $('admin-title').textContent = data.groupName || 'Your group';
  $('group-title').textContent = data.groupName || 'Group dashboard';
  $('group').textContent = data.groupName ? '· ' + data.groupName : '';
  $('limits').classList.toggle('hidden', !data.limits);
  if (data.limits) {
    $('limits').textContent = `Free demo limits: up to ${data.limits.maxMembers} members, weekly cap up to ${usd(data.limits.maxCapUsd)} each.`;
    $('m-cap').max = data.limits.maxCapUsd;
  }
  const ms = data.members;
  $('empty').classList.toggle('hidden', ms.length > 0);
  const spent = ms.reduce((s, m) => s + m.spentUsd, 0);
  const cap = ms.reduce((s, m) => s + m.weeklyCapUsd, 0);
  const reqs = ms.reduce((s, m) => s + (m.requests || 0), 0);
  $('totals').innerHTML = `
    <div><span class="muted small">Spent this week</span><b>${usd(spent)}</b></div>
    <div><span class="muted small">Total of caps</span><b>${usd(cap)}</b></div>
    <div><span class="muted small">Chats this week</span><b>${reqs}</b></div>`;
  $('members').innerHTML = ms
    .map((m) => {
      const pct = Math.min(100, (m.spentUsd / m.weeklyCapUsd) * 100 || 0);
      return `<tr data-id="${m.id}">
        <td><b>${escapeHtml(m.name)}</b>${m.paused ? ' <span class="badge">paused</span>' : ''}</td>
        <td><button class="code copy" data-act="copy" title="Copy join code">${m.code} ⧉</button></td>
        <td><div class="meter"><div class="${meterClass(pct)}" style="width:${pct}%"></div></div>
            <span class="small">${usd(m.spentUsd)} of ${usd(m.weeklyCapUsd)}${m.source ? ` · <span class="muted">${m.source}</span>` : ''}</span></td>
        <td>${m.requests ?? 0}</td>
        <td class="small">${escapeHtml(m.keyLabel || '')}</td>
        <td class="row">
          <button class="ghost" data-act="cap">Cap</button>
          <button class="ghost" data-act="pause">${m.paused ? 'Resume' : 'Pause'}</button>
          ${m.canRotate ? '<button class="ghost" data-act="rotate">New key</button>' : ''}
          <button class="ghost" data-act="remove">Remove</button>
        </td></tr>`;
    })
    .join('');
}

$('members').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('tr').dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'copy') {
      const code = btn.textContent.replace(' ⧉', '').trim();
      await navigator.clipboard?.writeText(code).catch(() => {});
      btn.textContent = 'Copied ✓';
      setTimeout(() => (btn.textContent = code + ' ⧉'), 1200);
      return;
    }
    if (act === 'cap') {
      const v = prompt('New weekly cap in US dollars (e.g. 0.50):');
      if (v === null) return;
      await api(`/api/admin/members/${id}`, { method: 'PATCH', body: { weeklyCapUsd: Number(v) } });
    } else if (act === 'pause') {
      const paused = btn.textContent === 'Pause';
      await api(`/api/admin/members/${id}`, { method: 'PATCH', body: { paused } });
    } else if (act === 'rotate') {
      if (!confirm('Issue a new Otari key for this member? The old one stops working.')) return;
      await api(`/api/admin/members/${id}/rotate`, { method: 'POST' });
    } else if (act === 'remove') {
      if (!confirm('Remove this member and revoke their Otari key?')) return;
      await api(`/api/admin/members/${id}`, { method: 'DELETE' });
    }
    await refreshMembers();
  } catch (err) {
    $('member-error').textContent = err.message;
  }
});

// ---------- chat ----------
const historyKey = () => 'bb-chat-' + (me ? me.id : 'anon');
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(historyKey())) || []; } catch { return []; }
}
function saveHistory(h) {
  localStorage.setItem(historyKey(), JSON.stringify(h.slice(-40)));
}

function renderMe() {
  $('hello').textContent = `Hi, ${me.name}!`;
  const status = $('member-status');
  if (me.aiStatus === 'paused') {
    status.textContent = 'Your parent has paused AI chat for your account. You can still view your budget. Ask them when you can use it again.';
    status.className = 'member-status paused';
  } else if (me.aiStatus === 'not_configured') {
    status.textContent = 'AI chat is not connected yet. Your parent has added your profile, but the app’s AI service still needs to be configured. Please try again later.';
    status.className = 'member-status unavailable';
  } else {
    status.textContent = '';
    status.className = 'member-status hidden';
  }
  const left = Math.max(0, me.weeklyCapUsd - me.spentUsd);
  const pct = Math.min(100, (me.spentUsd / me.weeklyCapUsd) * 100 || 0);
  const bar = $('me-bar');
  bar.style.width = pct + '%';
  bar.className = meterClass(pct);
  const reset = new Date(me.resetsAt).toLocaleDateString(undefined, { weekday: 'long' });
  $('me-left').textContent = `${usd(left)} left this week · refills ${reset}`;
}

// Models often answer in Markdown. Show **bold** as bold and drop heading marks; everything else stays plain, escaped text.
function lightMarkdown(s) {
  return escapeHtml(s)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

const SUGGESTIONS = ['Explain photosynthesis like I’m 10', 'Help me plan my essay', 'Quiz me on fractions', 'Why is the sky blue?'];
function renderChips(show) {
  $('chips').innerHTML = show ? SUGGESTIONS.map((t) => `<button type="button" class="chip">${t}</button>`).join('') : '';
}
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  $('msg').value = b.textContent;
  $('form-chat').requestSubmit();
});

function renderChat() {
  const h = loadHistory();
  renderChips(h.length === 0);
  $('chat').innerHTML = h.length
    ? h.map((m) => `<div class="bubble ${m.role}">${m.role === 'assistant' ? lightMarkdown(m.content) : escapeHtml(m.content)}${m.cost ? `<span class="cost">${m.cost}</span>` : ''}</div>`).join('')
    : '<p class="muted center">Ask anything to get started, or tap an idea below.</p>';
  $('chat').scrollTop = $('chat').scrollHeight;
}

async function openChat() {
  try {
    const r = await api('/api/me');
    me = r.member;
    if (r.groupName) $('group').textContent = '· ' + r.groupName;
  } catch {
    return show('landing');
  }
  show('chat');
  renderMe();
  renderChat();
}

$('form-chat').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('msg').value.trim();
  if (!text) return;
  $('chat-error').textContent = '';
  const h = loadHistory();
  h.push({ role: 'user', content: text });
  saveHistory(h);
  renderChat();
  $('msg').value = '';
  $('send').disabled = true;
  try {
    const out = await api('/api/chat', {
      method: 'POST',
      body: { messages: h.slice(-12).map(({ role, content }) => ({ role, content })) },
    });
    h.push({ role: 'assistant', content: out.reply, cost: `cost ${usd(out.costUsd)} · ${out.model || ''}` });
    saveHistory(h);
    if (out.member) me = out.member;
  } catch (err) {
    $('chat-error').textContent = err.message;
    if (err.data && err.data.member) me = err.data.member;
  } finally {
    $('send').disabled = false;
    renderMe();
    renderChat();
    $('msg').focus();
  }
});

// ---------- boot ----------
(async () => {
  try {
    const cfg = await api('/api/config');
    $('group').textContent = cfg.groupName ? '· ' + cfg.groupName : '';
  } catch {}
  openChat();
})();
