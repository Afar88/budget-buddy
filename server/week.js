// Budgets reset every Monday 00:00 UTC, the same boundary as Otari's
// `reset_alignment: calendar_week`.
function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

function nextReset(now = new Date()) {
  const d = weekStart(now);
  d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

module.exports = { weekStart, nextReset };
