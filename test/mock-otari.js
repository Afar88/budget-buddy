// A tiny fake of the Otari routes Budget Buddy calls, for offline tests.
const http = require('http');
function start(port = 0) {
  const state = { budgets: {}, users: {}, keys: {}, calls: [] };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : null;
      const auth = req.headers.authorization || '';
      state.calls.push({ method: req.method, url: req.url, auth, body: json });
      const send = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      const u = req.url.replace(/^\/api\/v1/, '');
      let m;
      if (req.method === 'POST' && u === '/chat/completions') {
        const tok = auth.slice(7);
        const key = Object.values(state.keys).find((k) => k.key === tok);
        if (key) {
          const user = state.users[key.user_id]; const b = state.budgets[user.budget_id];
          if (user.blocked) return send(403, { detail: 'User is blocked' });
          if (user.spend >= b.max_budget) return send(403, { detail: `User '${user.user_id}' has exceeded budget limit` }, { 'otari-error-code': 'budget_exceeded', 'retry-after': '3600' });
          user.spend += 0.0012; user.current_requests += 1;
        }
        return send(200, { id: 'chatcmpl-1', model: json.model, choices: [{ message: { role: 'assistant', content: 'Hello from mock Otari!' } }], usage: { total_tokens: 42, cost_usd: '0.001200', pricing_source: 'defaults' } }, { 'otari-request-id': 'req-123', 'otari-model': 'deepinfra:' + json.model });
      }
      if (auth !== 'Bearer admin-key') return send(401, { detail: 'Invalid master key' });
      if (req.method === 'PUT' && (m = u.match(/^\/budgets\/([^/]+)$/))) { state.budgets[m[1]] = { budget_id: m[1], ...json }; return send(200, state.budgets[m[1]]); }
      if (req.method === 'PATCH' && (m = u.match(/^\/budgets\/([^/]+)$/))) { Object.assign(state.budgets[m[1]], json); return send(200, state.budgets[m[1]]); }
      if (req.method === 'POST' && u === '/users') { state.users[json.user_id] = { ...json, spend: 0, reserved: 0, current_requests: 0, blocked: false, next_budget_reset_at: '2026-11-02T00:00:00Z' }; return send(201, state.users[json.user_id]); }
      if ((m = u.match(/^\/users\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'GET') return send(200, state.users[id]);
        if (req.method === 'PATCH') { Object.assign(state.users[id], json); return send(200, state.users[id]); }
        if (req.method === 'DELETE') { delete state.users[id]; return send(204, {}); }
      }
      if (req.method === 'POST' && u === '/keys') { const id = 'k' + Object.keys(state.keys).length; state.keys[id] = { id, ...json, key: 'tk-member-' + id, key_suffix: 'abcd' }; return send(201, state.keys[id]); }
      if (req.method === 'POST' && (m = u.match(/^\/keys\/([^/]+)\/rotate$/))) { state.keys[m[1]].key += '-r'; state.keys[m[1]].key_suffix = 'wxyz'; return send(200, state.keys[m[1]]); }
      if (req.method === 'DELETE' && (m = u.match(/^\/(keys|budgets)\/([^/]+)$/))) { delete state[m[1]][m[2]]; return send(204, {}); }
      send(404, { detail: 'Not Found' });
    });
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, state, url: `http://127.0.0.1:${srv.address().port}/api/v1` })));
}
module.exports = { start };
