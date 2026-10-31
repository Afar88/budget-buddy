// Vercel entry: the whole Express app runs as one serverless function.
// vercel.json rewrites every /api/* request here; the UI in public/ is served as static files.
module.exports = require('../server/index.js');
