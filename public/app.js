// Budget Buddy front end: plain JS, no build step.
const $ = (id) => document.getElementById(id);
const views = ['landing', 'admin-login', 'admin', 'chat'];
let pollTimer = null;
let me = null;

function show(name) {
  views.forEach((v) => $('view-' + v).classList.toggle('hidden', v !== name));
  $('nav-logout').classList.toggle('hidden', !(name === 'admin' || name === 'chat'));
  $('nav-admin').classList.toggle('hidden', name === 'admin');
  clearInterval(pollTimer);
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
$('form-code').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('code-error').textContent = '';
  try {
    await api('/api/member/login', { method: 'POST', body: { code: $('code').value } });
    openChat();
  } catch (err) {
    $('code-error').textContent = err.message;
  }
});

$('nav-admin').addEventListener('click', async () => {
  try {
    await api('/api/admin/members');
    openAdmin();
  } catch {
    show('admin-login');
  }
});

$('nav-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  show('landing');
});

// ---------- admin ----------
$('form-admin').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('admin-error').textContent = '';
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('admin-pass').value } });
    $('admin-pass').value = '';
    openAdmin();
  } catch (err) {
    $('admin-error').textContent = err.message;
  }
});

$('form-member').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('member-error').textContent = '';
  const btn = e.submitter;
  btn.disabled = true;
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
  }
});

async function openAdmin() {
  show('admin');
  await refreshMembers();
  pollTimer = setInterval(refreshMembers, 5000);
}

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
        <td class="code">${m.code}</td>
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

function renderChat() {
  const h = loadHistory();
  $('chat').innerHTML = h.length
    ? h.map((m) => `<div class="bubble ${m.role}">${m.role === 'assistant' ? lightMarkdown(m.content) : escapeHtml(m.content)}${m.cost ? `<span class="cost">${m.cost}</span>` : ''}</div>`).join('')
    : '<p class="muted">Ask a question to get started. Try “Explain photosynthesis like I’m 10”.</p>';
  $('chat').scrollTop = $('chat').scrollHeight;
}

async function openChat() {
  try {
    me = (await api('/api/me')).member;
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

$('clear').addEventListener('click', () => {
  localStorage.removeItem(historyKey());
  renderChat();
});

// ---------- boot ----------
(async () => {
  try {
    const cfg = await api('/api/config');
    $('group').textContent = cfg.groupName ? '· ' + cfg.groupName : '';
  } catch {}
  openChat();
})();
