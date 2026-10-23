const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { get, run } = require('../database');

let cachedSecret = null;

function getJwtSecret() {
  if (cachedSecret && !cachedSecret.startsWith('3dlib-temp-')) return cachedSecret;

  // 1. Check process.env.JWT_SECRET
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
    cachedSecret = process.env.JWT_SECRET.trim();
    return cachedSecret;
  }

  // 2. Check system_settings in SQLite database
  try {
    const row = get("SELECT value FROM system_settings WHERE key = 'jwt_secret'");
    if (row && row.value && row.value.trim().length >= 32) {
      cachedSecret = row.value.trim();
      return cachedSecret;
    }

    // 3. Generate a secure random 256-bit secret and persist it
    const newSecret = crypto.randomBytes(32).toString('hex');
    run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('jwt_secret', ?)", [newSecret]);
    cachedSecret = newSecret;
    console.log('✓ Generated and persisted secure 256-bit JWT secret key.');
    return cachedSecret;
  } catch (err) {
    // Database might not be ready yet during module load
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    return '3dlib-temp-' + crypto.randomBytes(16).toString('hex');
  }
}

// The login cookie
const TOKEN_COOKIE = '3dl_token';

function tokenCookieOptions(req) {
  return {
    httpOnly: true,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000
  };
}

// The account of a login token, or null. Role and account come from the database, not from the
// 30-day token: a user demoted to viewer or deleted loses the rights at once. Other tokens signed
// with the same secret (model unlock tokens: { unlock }) are no login. A login (it has a csrfToken;
// API keys have none) made before the last password change is over. Throws for a bad token.
function userFromToken(token) {
  const decoded = jwt.verify(token, getJwtSecret());
  const account = decoded && decoded.id ? get('SELECT id, role, token_version FROM users WHERE id = ?', [decoded.id]) : null;
  if (!account) return null;
  if (decoded.csrfToken && (decoded.tv || 0) !== (account.token_version || 0)) return null;
  return { ...decoded, role: account.role };
}

function authenticate(req, res, next) {
  let token = req.cookies[TOKEN_COOKIE];
  let isApiToken = false;
  
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
    isApiToken = true;
  }
  
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = userFromToken(token);
    if (!decoded) return res.status(401).json({ error: 'Invalid token' });

    // CSRF protection for state-changing methods (skip if using API token)
    if (!isApiToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const csrfToken = req.headers['x-csrf-token'];
      if (!csrfToken || csrfToken !== decoded.csrfToken) {
        return res.status(403).json({ error: 'CSRF token missing or invalid' });
      }
    }
    
    req.user = decoded;

    // Viewers cannot modify state, except their own profile. The full path: in a router mounted
    // at /api/auth, req.path is "/profile"
    const fullPath = req.baseUrl + req.path;
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.user.role === 'viewer') {
      if (!fullPath.startsWith('/api/auth/profile') && !fullPath.startsWith('/api/auth/logout')) {
        return res.status(403).json({ error: 'Viewer accounts cannot modify data' });
      }
    }

    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') next();
  else res.status(403).json({ error: 'Admin privileges required' });
}

function requireUploader(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'uploader' || req.user.role === 'user')) next();
  else res.status(403).json({ error: 'Uploader privileges required' });
}

module.exports = {
  authenticate,
  userFromToken,
  requireAdmin,
  requireUploader,
  getJwtSecret,
  TOKEN_COOKIE,
  tokenCookieOptions
};
