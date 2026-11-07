// Resend email delivery. No email content or credentials are logged.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function configured() {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

async function sendEmail({ to, subject, text, html }) {
  if (!configured()) throw new Error('Email delivery is not configured');
  const endpoint = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, html }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Email provider returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json().catch(() => ({}));
}

function linkFor(path, token) {
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/?${path}=${encodeURIComponent(token)}`;
}

async function sendVerification(group, token) {
  const url = linkFor('verify', token);
  await sendEmail({
    to: group.email,
    subject: 'Verify your Budget Buddy email',
    text: `Hi! Verify your Budget Buddy email by opening this link: ${url}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
    html: `<p>Hi!</p><p>Confirm your email address to finish setting up Budget Buddy.</p><p><a href="${escapeHtml(url)}">Verify my email</a></p><p>This link expires in 24 hours. If you did not create this account, you can ignore this email.</p>`,
  });
}

async function sendPasswordReset(group, token) {
  const url = linkFor('reset', token);
  await sendEmail({
    to: group.email,
    subject: 'Reset your Budget Buddy password',
    text: `Reset your Budget Buddy password using this link: ${url}\n\nThis link expires in 45 minutes. If you did not request this, ignore this email.`,
    html: `<p>A password reset was requested for your Budget Buddy account.</p><p><a href="${escapeHtml(url)}">Reset my password</a></p><p>This link expires in 45 minutes. If you did not request this, ignore this email.</p>`,
  });
}

module.exports = { configured, sendVerification, sendPasswordReset };
