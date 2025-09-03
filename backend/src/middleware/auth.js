// Basic authentication middleware
// Expects Authorization header with Basic scheme
// Stores user id in req.userId
module.exports = function (req, res, next) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
      const [user] = decoded.split(':');
      req.userId = user ? parseInt(user, 10) || user : null;
    } catch (e) {
      req.userId = null;
    }
  } else {
    req.userId = null;
  }
  next();
};
