# Budget Buddy: demo video script

Demo video for the Mozilla Otari "Developers Wilding" hackathon. Target length 3 to 5 minutes.
Recorded against the live app (https://budget-buddy-one-mu.vercel.app) with a scripted Playwright
walkthrough (headless Chromium, 1280x720 at 1.5x = 1920x1080, one real screenshot per video frame so
every pointer move and fade is smooth; waiting for the model is trimmed to about a second), voiceover generated locally with
Piper TTS (voice `en_US-lessac-high`), captions burned in, encoded to H.264 1080p with ffmpeg.
No music.

| # | Scene | On screen | Caption | Narration |
|---|-------|-----------|---------|-----------|
| 0 | Title card | "Budget Buddy" · "Built on Mozilla Otari" · by Avie | none | Budget Buddy. A weekly AI budget for everyone in your family or classroom. Built on Mozilla Otari. |
| 1 | The problem | Two cards: "Today: everyone shares one account" vs "Budget Buddy: a weekly budget for each person" | none | Most families and classrooms share one AI account. That means one key, one bill, and no way to say: Ada gets this much each week, and Tobi gets that much. When the money runs out, nobody knows who spent it, and nobody can switch one person off without switching everyone off. Budget Buddy fixes that, with a small, open source app on top of Otari. |
| 2 | Landing | Live app, join-code screen; pointer moves to "Grown-up / teacher" | Kids join with a 6-character code · no email, no password | This is the live app. Kids sign in with a short join code. There is no email and no password to remember. Grown-ups and teachers use the dashboard, behind this link at the top. |
| 3 | Dashboard | Click "Grown-up / teacher" (admin already signed in; the password is never shown). Totals, members Ada (14) and Mum with caps, codes, spend bars | Grown-up dashboard · weekly cap, join code, spend and chats per member | Here is the grown-up dashboard. Every member has a weekly cap, a join code, a spend bar, and a count of their chats this week. The totals at the top add up the whole group. Ada and Mum are already set up. |
| 4 | Add a member | Type "Tobi (11)", cap 0.25, Add member; new row with join code | Add a member with a weekly cap → instant join code | Let's add Tobi, who is eleven, with a weekly cap of twenty-five cents. Budget Buddy creates a six character join code for him straight away, and his budget starts at zero. |
| 5 | Member joins | Second browser: type Ada's code, Start chatting; meter "$0.50 left this week · refills Monday" | Ada joins on her own device with her code | Now Ada opens Budget Buddy on her own device, and types the code her parent gave her. She sees her name, and a meter with what is left of her budget this week, and when it refills. |
| 6 | First chat | "What is photosynthesis? Explain it like I'm 10, in three short sentences." Answer with "cost $0.0000xx · mistralai/…" under it; meter updates | Every answer shows its real cost, straight from Otari | She asks a homework question. The answer comes from Mistral Small 3, an open-weight model, through Otari. Under every answer, Budget Buddy shows exactly what that message cost, read from the cost that Otari returns with each response. The meter at the top updates straight away. |
| 7 | Second chat | "Can you give me a quick 3-question quiz on it?" | Remaining weekly budget updates after every answer | Then she asks for a quick quiz, to practise for her test. Each chat on this model costs well under a thousandth of a cent, so a fifty cent weekly cap goes a very long way. |
| 8 | Live spend | Back on the dashboard: Ada's spend and request count went up, totals updated | Spend and chat counts update live on the dashboard | Back on the dashboard, Ada's spend and her chat count have already gone up. The page refreshes every five seconds, so a parent or teacher always sees who is using what, live. |
| 9 | Pause | Click Pause on Ada; "paused" badge | Pause anyone with one tap | If it is dinner time, or homework is done, a grown-up taps Pause. |
| 10 | Blocked | Ada sends "Can I ask one more question?" → "Chat is paused for you right now. Ask your grown-up." Back on the dashboard, click Resume | Blocked before the model is called, so it costs nothing · Resume with one tap · caps refill every Monday | Ada's next message is blocked before it ever reaches the model, so it costs nothing. The same block happens automatically when someone reaches their weekly cap, and every cap refills on Monday. One tap on Resume, and she is back. |
| 11 | How it's built | Two cards: hosted otari.ai (shared key, member tags, `usage.cost_usd`, app-enforced caps) vs self-hosted Otari (`OTARI_ADMIN_KEY`, virtual key + `calendar_week` budget per member, Otari-enforced, pause blocks the Otari user, "New key" rotates) | none | Here is how it is built on Otari. On hosted otari.ai, the app uses one key. Every request is tagged with the member, and Budget Buddy enforces each weekly cap using the cost Otari returns. With a self-hosted Otari gateway, you add a master key, and each member gets their own Otari virtual key and a calendar-week budget, so Otari itself enforces the cap. Pause blocks that member's Otari user, and New key rotates their key. |
| 12 | End card | Budget Buddy · Built on Mozilla Otari · github.com/Afar88/budget-buddy · budget-buddy-one-mu.vercel.app · by Avie | none | Budget Buddy is open source. Run it for free on Vercel with an otari.ai key, or next to your own self-hosted Otari gateway. Built on Mozilla Otari, by Avie. Thanks for watching. |

Notes

- Why pause instead of a full cap: one chat on Mistral Small 3 costs about $0.00002, and the smallest
  cap is $0.01, so filling a cap on camera would take hundreds of real chats. The cap check runs
  on the same path as Pause (before the model is called) and returns "You've used this week's
  budget. It refills on Monday!".
- Every cost shown in the video is the real `usage.cost_usd` Otari returned for that request.
