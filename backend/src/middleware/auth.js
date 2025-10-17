// Basic authentication middleware with username/password
// Authorization: Basic base64(username:password)
// On success sets req.userId, req.username, req.userRole
const db = require('../db');
const { verifyPassword } = require('../utils/password');

module.exports = async function (req, _res, next) {
  req.userId = null;
  req.username = null;
  req.userRole = null;
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const username = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const password = sep >= 0 ? decoded.slice(sep + 1) : '';
      if (username) {
        // Look up user
        const rows = await db.public.many('SELECT id, username, password_hash, role FROM users WHERE username = $1', [username]);
        const user = Array.isArray(rows) && rows[0];
        if (user && verifyPassword(password, user.password_hash)) {
          req.userId = user.id;
          req.username = user.username;
          req.userRole = user.role || 'campo';
        }
      }
    } catch (_) {
      // ignore, leave as unauthenticated
    }
  }
  next();
};
