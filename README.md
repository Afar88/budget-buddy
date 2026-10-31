# 🪙 Budget Buddy

**AI chat for families and classrooms, where every member gets their own weekly AI budget.**

A parent or teacher adds members (kids, students, a whole class). Each member signs in with a short join code and chats with an AI helper. Behind the scenes every member has their **own Otari virtual key with a weekly spend cap**, and the grown-up sees each member's **live spend against their cap** on a dashboard. When someone's week is used up, Otari refuses the next request before any model is called, and the allowance refills every Monday.

Built for **[Developers Wilding: Online](https://otari.ai/devs-wilding)**, Mozilla.ai's MozFest 2026 hackathon, on **[Otari](https://github.com/mozilla-ai/otari)**, the open-source LLM gateway.

> Built by **Avie** ([@Afar88](https://github.com/Afar88))

---

## Why

Giving kids or a class access to AI usually means one of two bad options: share one API key and hope nobody burns through it, or don't offer AI at all. Budget Buddy gives every person their own small, safe allowance, the same way pocket money works, and gives the adult one screen to see and adjust it. It works anywhere in the world: costs are in USD cents, and the model is open-weight by default.

## Otari features used

| Otari feature | How Budget Buddy uses it | Code |
| --- | --- | --- |
| **Chat completions** (OpenAI-compatible) | All member chat goes through `POST /api/v1/chat/completions` on Otari | `server/otari.js` → `chat()` |
| **Virtual keys** | One Otari API key per member (`POST /keys`), rotated from the dashboard (`POST /keys/{id}/rotate`) and revoked when a member is removed (`DELETE /keys/{id}`) | `provisionMember()`, `rotateKey()`, `deprovision()` |
| **Budgets** | One weekly budget per member (`PUT /budgets/{id}` with `max_budget` and `reset_alignment: calendar_week`), editable from the dashboard (`PATCH /budgets/{id}`) | `provisionMember()`, `setCap()` |
| **Users + budget enforcement** | Each member is an Otari user attached to its budget; Otari reserves cost before dispatch and refuses with `403 budget_exceeded` + `Retry-After` when the week is spent. Pause = `PATCH /users/{id} {blocked:true}` | `provisionMember()`, `setBlocked()` |
| **Usage tracking** | Live dashboard reads each member's `spend`, `reserved`, `current_requests` and `next_budget_reset_at` from `GET /users/{id}`; every response's inline `usage.cost_usd` is shown under each answer | `getUser()`, `usageFor()` |
| **Request tags** | Every request carries `metadata: {app, member, member_name, group}` so usage can be filtered and grouped per member in the Otari dashboard (`/usage/summary?group_by_tag=member`) | `chat()` |
| **Open-weight models via one endpoint** | Default model `mistralai/mistral-small-3`; switch to any model in the Otari catalog with `OTARI_MODEL` | `.env.example` |

### Two modes

Budget Buddy picks a mode from your environment:

- **Managed mode** (`OTARI_ADMIN_KEY` set): the full experience above. Each member gets a real Otari virtual key and an Otari weekly budget, and **Otari itself enforces the cap**. Use this with a self-hosted Otari (the key is the gateway's master key), or with any Otari token that may manage keys, users and budgets.
- **Hosted mode** (only `OTARI_API_KEY` set): for a plain otari.ai account. On hosted otari.ai, the key/user/budget management routes accept a dashboard session or the master key, not a tenant API key, so the app can't mint keys for you. Members share the app's key, every request is **tagged with the member**, and Budget Buddy enforces each weekly cap from the **exact cost Otari returns on every response**. (Pasting per-member keys made in the otari.ai dashboard, for hard Otari-side caps on hosted, is on the roadmap.)

The dashboard badge shows which mode you're in.

## Screenshots

_Coming soon: admin dashboard, member chat, and the "budget used up" moment._

<!-- ![Admin dashboard](docs/admin.png) ![Member chat](docs/chat.png) -->

## Run it locally

Requires Node.js 18.17+ (20+ recommended).

```bash
git clone https://github.com/Afar88/budget-buddy.git
cd budget-buddy
git checkout hackathon
npm install
cp .env.example .env     # then edit .env: add your Otari key and an admin password
npm start                # http://localhost:3000
```

1. Get an Otari key at [otari.ai](https://otari.ai) (Dashboard → API keys) and put it in `OTARI_API_KEY`. **Never commit `.env`.**
2. Open http://localhost:3000, click **Grown-up / teacher**, sign in with `ADMIN_PASSWORD`.
3. Add a member with a weekly cap (e.g. Ada, $0.50). Share their 6-letter join code.
4. The member enters the code on the home page and starts chatting. Watch their bar move on the dashboard.

### Managed mode with a self-hosted Otari

```bash
# in a clone of github.com/mozilla-ai/otari, with a provider key configured
docker compose up -d
```

Then in Budget Buddy's `.env`:

```
OTARI_BASE_URL=http://localhost:8000/api/v1
OTARI_ADMIN_KEY=<your Otari master key>
OTARI_API_KEY=<any Otari key, used only when a member has no own key>
OTARI_MODEL=<a model your gateway serves, e.g. openai:gpt-4o-mini>
```

### Environment

| Variable | What it does |
| --- | --- |
| `OTARI_API_KEY` | otari.ai API key used for chat in hosted mode |
| `OTARI_BASE_URL` | Otari API base, default `https://api.otari.ai/api/v1` (EU: `https://eu.api.otari.ai/api/v1`) |
| `OTARI_ADMIN_KEY` | Optional. Enables managed mode (own key + budget per member) |
| `OTARI_MODEL` | Model id or `provider:model` selector, default `mistralai/mistral-small-3` |
| `OTARI_MAX_TOKENS` | Output cap per answer (default 400). Keeps answers short and Otari's up-front budget hold small |
| `ADMIN_PASSWORD` | Password for the grown-up / teacher dashboard |
| `SESSION_SECRET` | Long random string used to sign session cookies |
| `GROUP_NAME` | Shown in the header, e.g. "Room 4B" |
| `DATA_FILE` | JSON file for members and the usage ledger (default `./data/db.json`). Used when no Redis is configured |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis REST endpoint + token (injected by Vercel's Upstash/KV integration). When set, data lives in Redis instead of the JSON file. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work |

### Tests

```bash
npm test
```

Runs the whole flow (create member → chat → hit the cap → change cap, pause, rotate, remove) against a small mock of the Otari API in `test/mock-otari.js`, in both modes, plus a Redis-store test (a fresh instance must see the data the first one saved) against a tiny Upstash REST mock. No Otari credit is spent.

## Deploy for free

### Vercel (Hobby plan, free)

The repo is ready for Vercel as-is: `api/index.js` runs the whole Express app as one serverless function, `vercel.json` rewrites `/api/*` to it, and `public/` is served as static files. There is no build step.

1. On [vercel.com](https://vercel.com), **Add New → Project** and import this repo (branch `hackathon`). Framework preset: **Other**.
2. Vercel's disk does not persist between requests, so add storage: project **Storage → Create / Marketplace → Upstash (Redis)**, free plan, and connect it to the project. It injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`), and Budget Buddy switches to Redis automatically.
3. In **Settings → Environment Variables** set `OTARI_API_KEY`, `ADMIN_PASSWORD`, `SESSION_SECRET` (any long random string; required so sign-ins survive across function instances) and optionally `OTARI_MODEL` and `GROUP_NAME`.
4. Deploy (or redeploy after adding the variables). Open the URL, sign in as the grown-up, add a member, and share their join code.

Without the Redis variables the app falls back to the JSON file, which on Vercel would reset between requests, so don't skip step 2.

### Any Node host

It's a single Node process with no build step, so any free Node host works (Render, Railway's trial, Fly.io, Koyeb, a Raspberry Pi at school). Set the environment variables above in the host's dashboard. On hosts with an ephemeral disk, the JSON data file resets on redeploy; mount a volume or point `DATA_FILE` at persistent storage if you need it to last.

## How it works

```
member browser ──► Budget Buddy (Express) ──► Otari gateway ──► open-weight model
                     │  join codes, sessions      │  virtual key per member
                     │  admin dashboard           │  weekly budget per member (calendar_week)
                     │  reads live spend  ◄───────┘  usage + inline cost per request
```

- Member keys never reach the browser; the server makes every Otari call.
- Chat history stays in the member's own browser (localStorage); the server stores only names, caps and per-request costs.
- A friendly, age-appropriate system prompt is on by default (override with `SYSTEM_PROMPT`).

## Project structure

```
server/index.js     Express routes: admin, members, chat
server/otari.js     Otari client: chat, keys, budgets, users, usage
server/store.js     store: Upstash Redis (Vercel) or JSON file (local)
api/index.js        Vercel serverless entry (wraps the Express app)
vercel.json         Vercel routing: /api/* -> function, public/ static
server/auth.js      signed-cookie sessions
server/week.js      weekly reset boundary (Monday 00:00 UTC, matches Otari calendar_week)
public/             plain HTML/CSS/JS front end, no build step
test/               end-to-end tests against a mock Otari
```

## Roadmap

- Per-member model allow-lists (`allowed_models`) so younger members only get certain models
- Usage history chart from Otari's `/usage/series`
- Optional request-count caps (`request_limit`) alongside dollar caps
- Paste-in per-member keys from the otari.ai dashboard for hard caps in hosted mode

## Credits

- Built by **Avie** ([@Afar88](https://github.com/Afar88)) for Mozilla.ai's Developers Wilding hackathon.
- AI gateway: [Otari](https://github.com/mozilla-ai/otari) by Mozilla.ai (Apache-2.0).

## License

MIT
