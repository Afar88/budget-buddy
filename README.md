# Budget Buddy

**A family- and classroom-friendly AI chat app with per-member weekly spending limits.**

A parent or teacher creates a private group, adds members, sets a weekly AI budget for each person, and shares a six-character join code. Members use that code to chat with an age-appropriate AI helper. Adults can see usage, adjust limits, pause access, rotate managed Otari keys, or remove a member.

**Live app:** https://budget-buddy-one-mu.vercel.app  
**Repository:** https://github.com/Afar88/budget-buddy  
**Built by:** [Avie (@Afar88)](https://github.com/Afar88)

## Try the live app

1. Open the [Budget Buddy app](https://budget-buddy-one-mu.vercel.app).
2. Choose **Create free account** and enter a family/class name, email and password (at least 8 characters).
3. From the grown-up dashboard, add a member and set a weekly cap. Copy the six-character join code.
4. Open the member sign-in option in another browser or private window, enter the code and send a chat message.
5. Return to the grown-up dashboard to view usage, adjust the cap, pause access or remove the member.

The live demo uses hosted Otari mode and a shared, capped Otari key. New self-service groups are limited by `SIGNUP_MAX_MEMBERS` (default 10) and `SIGNUP_MAX_CAP_USD` (default $1.00 per member per week). A demo join code may be displayed in the live app; use your own group and code for private testing.

## How to Use Budget Buddy

Budget Buddy separates duties between grown-ups (who manage accounts, budgets, and keys) and learners (who access safe AI chat using friction-free join codes).

### 1. For Parents and Teachers (Grown-Up Dashboard)

* **Create & Verify Account**:
  1. Click **Create free account** on the home screen.
  2. Enter a group name (e.g., *The Smiths* or *Class 5B*), your email, and a secure password (8+ characters).
  3. Check your email inbox and click **Verify my email** to activate your account.
  4. *(Tip: If you ever lose your password, use **Forgot password?** to receive a single-use 45-minute reset link).*

* **Add Members & Assign Budgets**:
  1. Once logged into your dashboard, enter each child or student’s name.
  2. Set their weekly AI spending cap in dollars (e.g., `$0.50` or `$1.00`).
  3. Click **Add member**. Budget Buddy creates a unique, kid-friendly 6-character join code (e.g., `K9M2PX`, using characters with no look-alikes like `0/O` or `1/I/L`).

* **Share Join Code or Printable QR Cards**:
  * Tap **QR** next to any member to open their ready-to-print student card with an instant-scan QR code and 6-character code.
  * Tap **New code** anytime to rotate a compromised or shared join code immediately.
  * Tap **Export CSV** on the group dashboard to download a full breakdown of member usage, spending, and limits.

* **Live Monitoring & Safety Controls**:
  * **Real-Time Usage**: Monitor exact spent amounts, message counts, and live cost-per-chat.
  * **Automatic Refills**: Member budgets automatically reset every **Monday at 00:00 UTC**.
  * **Pause Access**: Toggle a member to "Paused" to temporarily disable chat without deleting their profile.
  * **Adjust Limits**: Change weekly spending caps up or down on the fly.
  * **Remove Member**: Delete a profile to revoke access and clean up associated Otari virtual keys.

---

### 2. For Children and Students (Kid-Friendly AI Chat)

* **Instant Sign-In**:
  1. Open Budget Buddy on any phone, tablet, Chromebook, or browser.
  2. Enter your **6-character join code** and tap **Start chatting**. No personal details or passwords are requested.

* **Engaging, Safe AI Helper**:
  * Ask questions about science, history, coding, or language.
  * Budget Buddy explains concepts step-by-step to help you learn, rather than simply handing over homework answers.
  * Tap any of the starter idea chips for inspiration.

* **Weekly Budget Transparency**:
  * The top status bar shows your remaining weekly budget and exact costs per prompt.
  * If your cap is reached, Budget Buddy kindly informs you that your balance refills on Monday morning.

---

## How budgeting works

Budget Buddy supports two Otari configurations:

- **Managed mode** (`OTARI_ADMIN_KEY` configured): Budget Buddy provisions a separate Otari virtual key, user and calendar-week budget for each member. Otari enforces that member's cap before dispatching a model request. Adults can change the cap, pause the Otari user, rotate its key and revoke its resources when the member is removed.
- **Hosted mode** (only `OTARI_API_KEY` configured): members share the app's Otari key. Requests are tagged with the member and group, and Budget Buddy checks the member's weekly total using the cost returned by Otari. On Redis-backed deployments, a distributed write lock serializes state-changing requests—including chat—so two requests cannot both pass the same stale budget check. Competing writes receive HTTP 503 with `Retry-After` and should be retried. Managed Otari mode remains preferable when strict per-member enforcement is required.

The default model is `mistralai/mistral-small-3`. Change it with `OTARI_MODEL` to a model available to your Otari account.

## Run locally

Requires Node.js 18.17+ (Node 20+ recommended).

```bash
git clone https://github.com/Afar88/budget-buddy.git
cd budget-buddy
git checkout hackathon
npm install
```

### Run the app with the included mock Otari service

This is the easiest way to try the full flow without spending API credits:

```bash
node -e "require('./test/mock-otari').start(8787)"
```

In a second terminal:

```bash
OTARI_BASE_URL=http://127.0.0.1:8787/api/v1 \
OTARI_ADMIN_KEY=admin-key \
ADMIN_PASSWORD=test \
SESSION_SECRET=replace-this-with-a-long-random-secret \
npm start
```

Open http://localhost:3000, create a free account or sign in to the built-in demo group with password `test` (leave email blank), add a member, then join with the generated code in a private window. Mock replies say “Hello from mock Otari!”.

### Run with a real Otari account

Copy `.env.example` to `.env`, add your full Otari API key and a strong session secret, then run `npm start`.

```bash
cp .env.example .env
# Edit .env and set OTARI_API_KEY, ADMIN_PASSWORD and SESSION_SECRET
npm start
```

Never commit `.env` or expose an Otari key in browser code.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `OTARI_API_KEY` | Otari chat key; used in hosted mode and as a fallback in managed mode |
| `OTARI_BASE_URL` | Otari API base URL; defaults to `https://api.otari.ai/api/v1` |
| `OTARI_ADMIN_KEY` | Enables managed mode and member-specific Otari resources |
| `OTARI_MODEL` | Model ID; defaults to `mistralai/mistral-small-3` |
| `OTARI_MAX_TOKENS` | Maximum answer length; defaults to 400 |
| `OTARI_TEMPERATURE` | Sampling temperature; defaults to 0.3 |
| `ADMIN_PASSWORD` | Password for the built-in demo/admin login |
| `SESSION_SECRET` | Long, random secret used to sign session cookies; set this in production |
| `GROUP_NAME` | Display name for the built-in demo group |
| `SIGNUP_MAX_MEMBERS` | Maximum members per self-service group; defaults to 10 |
| `SIGNUP_MAX_CAP_USD` | Maximum weekly cap per member in self-service groups; defaults to 1 |
| `MAX_GROUPS` | Maximum self-service groups; defaults to 500 |
| `DATA_FILE` | Local JSON database path; defaults to `./data/db.json` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis REST connection used on Vercel |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Alternative Upstash Redis environment variable names |

## Deploy to Vercel

1. Import this repository into Vercel and select the `hackathon` branch.
2. Add an Upstash Redis integration and connect it to the project. Vercel's filesystem is ephemeral; the JSON-file fallback is not suitable for persistent production data.
3. Add `OTARI_API_KEY`, `ADMIN_PASSWORD` and a unique, high-entropy `SESSION_SECRET` to the Vercel environment variables. Add `OTARI_ADMIN_KEY` only if using managed mode. Set optional model and group settings as needed.
4. For email verification and password recovery, choose one provider. **No-domain option:** create a Sendliberty account, connect a Gmail account through Google's OAuth consent screen, generate an API key, then add `SENDLIBERTY_API_KEY`, `SENDLIBERTY_FROM` (the connected Gmail address), and `APP_BASE_URL` to Vercel Production. **Resend option:** verify a sending domain, then add `RESEND_API_KEY`, `EMAIL_FROM` and `APP_BASE_URL`. Redeploy after adding the variables. Never commit provider keys.
5. Deploy and verify account creation, email verification, password recovery, member join, a chat request and dashboard usage.

The project has no frontend build step. `api/index.js` serves the Express app as a Vercel function, while `public/` contains the static frontend.

## Security and known limitations

- Parent/teacher member-management routes verify group ownership. Requests to edit, rotate or delete another group's member are rejected.
- Admin login is limited to 10 attempts per IP per 15 minutes, group signup to 5, and member join-code login to 60 to avoid blocking a whole classroom behind one shared school network. On Redis-backed deployments, these counters are atomic and shared across Vercel instances; if Redis is unavailable, sign-in endpoints fail closed with HTTP 503. Local development uses an in-memory fallback. Edge/WAF limits remain useful as an additional layer.
- Treat join codes as credentials. Share them privately. Adults can rotate a member’s 6-character join code at any time with the **New code** button on the group dashboard.
- Keep Redis connected on Vercel and use a strong `SESSION_SECRET`. Never commit environment files or send private Otari keys to the browser.
- The Redis adapter stores app state as one JSON document, but state-changing API requests now acquire a distributed Redis lease before loading and saving it. This prevents concurrent Vercel instances from overwriting each other's snapshots. The lease lasts 120 seconds; keep Vercel function execution limits below that duration. If another writer holds the lease, the request fails closed with HTTP 503 and `Retry-After` rather than writing stale state. This is a safe low-volume workaround, not a substitute for a normalized transactional database at higher scale.
- Hosted-mode budget checks and ledger writes run under the same distributed write lock, preventing overlapping chats from both spending the same remaining balance. The trade-off is that writes and chat requests are serialized across the whole app, so throughput is intentionally limited. A future normalized data model can replace this coarse lock with per-member atomic reservations.
- New self-service accounts must verify their email before signing in. Verification links expire after 24 hours; resend requests are rate-limited. Password reset links expire after 45 minutes, are single-use, and store only token hashes. Resetting a password invalidates existing admin sessions. Legacy accounts without an `emailVerified` field remain verified so existing users are not locked out.
- Email delivery supports Sendliberty (Gmail OAuth relay; no custom domain required) or Resend (verified sending domain required). Signup is unavailable until one provider is configured; `APP_BASE_URL` must point to the canonical public app URL so email links return to the correct deployment. Forgot-password responses do not reveal whether an email address has an account. Sendliberty is a third-party relay: review its privacy policy and Google OAuth permissions before connecting a production Gmail account.

## Tests

```bash
npm test
```

The Node test suite uses mock Otari, Redis and email services and covers managed mode, hosted mode, weekly cap behavior, member management, Redis persistence across fresh instances, distributed write-lock contention, email verification, password recovery, session invalidation and authentication throttling. It does not send real email or spend Otari credits.

## Project structure

```
server/index.js     Express routes: signup, login, members and chat
server/otari.js     Otari client: chat, keys, budgets, users and usage
server/store.js     Upstash Redis (Vercel) or local JSON storage
server/auth.js      Signed-cookie sessions, password helpers and login throttling
server/week.js      Weekly reset boundary
api/index.js        Vercel serverless entry point
public/             Static HTML, CSS and browser JavaScript
test/               Integration tests and mock Otari service
```

## Credits and license

- Built by **Avie** ([Afar88](https://github.com/Afar88)).
- AI gateway: [Otari](https://github.com/mozilla-ai/otari) by Mozilla.ai (Apache-2.0).
- This project is released under the MIT License.

## Changelog
- **2026-11-07:** Added real-time streaming chat responses (SSE), student QR code sign-in cards, 1-click self-service join-code rotation, CSV reporting export for parents and teachers, educational subject tutor modes (Math, Science, Writing, History), and PWA tablet/mobile offline shell installability.

- **2026-11-07:** Added domain-free Sendliberty Gmail-relay support alongside Resend for verification and password recovery; both use expiring hashed one-time tokens, rate limits and session invalidation on password reset.
- **2026-11-07:** Added atomic Redis-backed authentication throttling shared across Vercel instances, with fail-closed behaviour when Redis is unavailable and cross-instance coverage.
- **2026-11-07:** Added a distributed Redis write lock for state-changing requests, fail-closed retry responses, and cross-instance contention coverage. Hosted chat budget checks and ledger writes now run within the same lock; README documents the throughput trade-off.
- **2026-11-07:** Added private group signup, group-scoped member management, hosted/managed Otari modes and the mobile-first onboarding refresh.
