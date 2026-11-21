// The user's Bambu Lab account, for the MakerWorld files of the source import: MakerWorld gives
// profile 3MFs and raw model files only to a logged-in user. The user logs in once in Profile ->
// API & Integrations with a code Bambu Lab sends by e-mail: no password ever reaches 3DLib (an
// account made with "Sign in with Google" has none anyway). 3DLib keeps only what Bambu Lab
// answers: the access token, its refresh token and when it expires.
//
// Bambu's code login (api.bambulab.com, like "Log in with a verification code" on its site):
//   POST /v1/user-service/user/sendemail/code { email, type: 'codeLogin' }   the code is sent
//   POST /v1/user-service/user/login { account, code }
//     -> { accessToken, refreshToken, expiresIn }            logged in
//     -> { loginType: 'tfa', tfaKey }                         two-factor authentication:
//          POST https://bambulab.com/api/sign-in/tfa { tfaKey, tfaCode } -> cookie "token"
//   POST /v1/user-service/user/refreshtoken { refreshToken } -> new tokens
// users.bambu_* keep the account; bambu_status 'ok' / 'invalid' (MakerWorld refused the token).
const https = require('https');
const http = require('http');
const { get, run } = require('../database');
const { USER_AGENT } = require('./sources/http');

const API = 'https://api.bambulab.com';
const TFA = 'https://bambulab.com/api/sign-in/tfa';
const TIMEOUT_MS = 30000;

// The tests answer for Bambu Lab: https://<host>/<path> -> <origin>/<host>/<path>
const TEST_ORIGIN = process.env.NODE_ENV === 'test' ? (process.env.SOURCE_IMPORT_TEST_ORIGIN || '') : '';

class LoginError extends Error {}

// POST JSON; { status, json, cookies } whatever the status
function post(url, body) {
  return new Promise((resolve, reject) => {
    const target = TEST_ORIGIN ? `${TEST_ORIGIN}/${url.replace(/^https?:\/\//, '')}` : url;
    const data = Buffer.from(JSON.stringify(body));
    const lib = target.startsWith('https:') ? https : http;
    const req = lib.request(target, {
      method: 'POST',
      timeout: TIMEOUT_MS,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json', 'content-type': 'application/json', 'content-length': data.length }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* not JSON */ }
        const cookies = {};
        for (const c of [].concat(res.headers['set-cookie'] || [])) {
          const m = /^([^=;\s]+)=([^;]*)/.exec(c);
          if (m) cookies[m[1]] = m[2];
        }
        resolve({ status: res.statusCode, json, cookies });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const errorOf = (r, fallback) => (r.json && (r.json.error || r.json.message)) || (r.status === 403 ? 'Bambu Lab refused the request; try again later' : fallback);

// What the browser may know about the account (never a token)
function accountOf(user) {
  if (!user || !user.bambu_token) return { set: false };
  return { set: true, account: user.bambu_account || '', status: user.bambu_status || 'ok', expires_at: user.bambu_expires_at || null, checked_at: user.bambu_checked_at || null };
}

function save(userId, account, tokens) {
  const expires = Number(tokens.expiresIn) > 0 ? new Date(Date.now() + Number(tokens.expiresIn) * 1000).toISOString() : null;
  run("UPDATE users SET bambu_account = ?, bambu_token = ?, bambu_refresh_token = ?, bambu_expires_at = ?, bambu_status = 'ok', bambu_checked_at = datetime('now') WHERE id = ?",
    [account, tokens.accessToken, tokens.refreshToken || null, expires, userId]);
  return accountOf(get('SELECT * FROM users WHERE id = ?', [userId]));
}

// Step 1: Bambu Lab sends a code to the e-mail of the account
async function sendCode(account) {
  const r = await post(`${API}/v1/user-service/user/sendemail/code`, { email: account, type: 'codeLogin' });
  if (r.status !== 200 || (r.json && r.json.code && r.json.error)) throw new LoginError(errorOf(r, 'Bambu Lab could not send the code'));
}

// Step 2 with the code from the e-mail: { state: 'done', bambu } | { state: 'tfa', tfaKey }
async function loginWithCode(userId, account, code) {
  const r = await post(`${API}/v1/user-service/user/login`, { account, code });
  const j = r.json || {};
  if (r.status === 200 && j.accessToken) return { state: 'done', bambu: save(userId, account, j) };
  if (r.status === 200 && j.loginType === 'tfa' && j.tfaKey) return { state: 'tfa', tfaKey: j.tfaKey };
  throw new LoginError(errorOf(r, 'Bambu Lab did not take the code'));
}

// Step 2 with the code of the authenticator app
async function loginWithTfa(userId, account, tfaKey, code) {
  const r = await post(TFA, { tfaKey, tfaCode: code });
  const token = r.cookies.token || (r.json && r.json.accessToken);
  if (r.status === 200 && token) return save(userId, account, { accessToken: token, refreshToken: r.cookies.refreshToken || null, expiresIn: r.json && r.json.expiresIn });
  throw new LoginError(errorOf(r, 'Bambu Lab did not take the code'));
}

function logout(userId) {
  run('UPDATE users SET bambu_account = NULL, bambu_token = NULL, bambu_refresh_token = NULL, bambu_expires_at = NULL, bambu_status = NULL, bambu_checked_at = NULL WHERE id = ?', [userId]);
}

function mark(userId, status) {
  run("UPDATE users SET bambu_status = ?, bambu_checked_at = datetime('now') WHERE id = ? AND bambu_token IS NOT NULL", [status, userId], true);
}

// The user's access token for MakerWorld, refreshed when it is about to expire; null without a
// login. An expired one that cannot be refreshed marks the account 'invalid'.
async function tokenFor(userId) {
  const u = userId ? get('SELECT * FROM users WHERE id = ?', [userId]) : null;
  if (!u || !u.bambu_token) return null;
  const expires = u.bambu_expires_at ? Date.parse(u.bambu_expires_at) : NaN;
  if (!(expires < Date.now() + 24 * 3600 * 1000)) return u.bambu_token;
  if (u.bambu_refresh_token) {
    try {
      const r = await post(`${API}/v1/user-service/user/refreshtoken`, { refreshToken: u.bambu_refresh_token });
      if (r.status === 200 && r.json && r.json.accessToken) {
        save(userId, u.bambu_account, { refreshToken: u.bambu_refresh_token, ...r.json });
        return r.json.accessToken;
      }
    } catch (e) { /* the old token is tried below while it lasts */ }
  }
  if (expires > Date.now()) return u.bambu_token;
  mark(userId, 'invalid');
  return null;
}

module.exports = { sendCode, loginWithCode, loginWithTfa, logout, mark, tokenFor, accountOf, LoginError };
