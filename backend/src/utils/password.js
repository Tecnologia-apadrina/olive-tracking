const crypto = require('crypto');

const ALGO = 'scrypt';
const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  return `${ALGO}:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, salt, hash] = String(stored).split(':');
  if (algo !== ALGO || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  // timingSafeEqual comparison
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword };

