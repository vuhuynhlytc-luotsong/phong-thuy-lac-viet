// Phong Thủy Lạc Việt – máy chủ cho Pi Desktop (Docker). Đăng nhập bằng key + tự cập nhật từ GitHub.
// Biến môi trường: ADMIN_TOKEN (bắt buộc), UPDATE_BASE, GITHUB_TOKEN (nếu repo private), COOKIE_SECURE=1 (nếu chạy qua HTTPS)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fetchManifest, download, cmpVer, NAME_RE, PROTECTED, MIME } from './updater.mjs';
const ROOT = path.dirname(new URL(import.meta.url).pathname), PUB = path.join(ROOT, 'public'), DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const ADMIN = process.env.ADMIN_TOKEN || '', BASE = process.env.UPDATE_BASE || '';
const GH = process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {};
const KEYF = path.join(DATA, 'keys.json'), METAF = path.join(DATA, 'site-meta.json'), SITE = path.join(DATA, 'site');
const OPEN = new Set(['/login.html', '/favicon.png', '/admin.html']), fails = new Map(), DAY = 864e5;
fs.mkdirSync(SITE, { recursive: true });
const rj0 = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
{ // bản đóng gói (publish lại) mới hơn hoặc bằng bản đã cập nhật từ xa -> bỏ bản cũ trong data, dùng bản đóng gói
  const m0 = rj0(METAF, { cur: '' }), b0 = rj0(path.join(PUB, 'version.json'), {}).version || '1.0.0';
  if (m0.cur && cmpVer(m0.cur, b0) <= 0) { fs.rmSync(SITE, { recursive: true, force: true }); fs.mkdirSync(SITE, { recursive: true }); fs.writeFileSync(METAF, JSON.stringify({ cur: '', prev: '' })); console.log('Bản đóng gói v' + b0 + ' mới hơn bản đã cập nhật v' + m0.cur + ', dùng bản đóng gói'); }
}
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const wj = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, f); };
const keys = () => rj(KEYF, []), meta = () => rj(METAF, { cur: '', prev: '' });
const bundled = () => rj(path.join(PUB, 'version.json'), {}).version || '1.0.0';
const today = () => new Date().toISOString().slice(0, 10), alive = r => !!r && r.active && (!r.expires || r.expires >= today());
const send = (res, c, o, h = {}) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }); res.end(JSON.stringify(o)); };
const body = r => new Promise(ok => { let b = ''; r.on('data', c => { b += c; if (b.length > 1e5) r.destroy(); }); r.on('end', () => { try { ok(JSON.parse(b)); } catch { ok({}); } }); });
const b64u = b => Buffer.from(b).toString('base64url');
const secret = () => crypto.createHash('sha256').update('sess:' + ADMIN).digest();
const sign = p => crypto.createHmac('sha256', secret()).update(p).digest('base64url');
const eq = (a, b) => { const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y); };
function session(req) {
  try {
    const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
    const [p, s] = m[1].split('.'); if (!p || !s || !eq(sign(p), s)) return null;
    const d = JSON.parse(Buffer.from(p, 'base64url').toString()); if (!(d.e > Date.now())) return null;
    const rec = keys().find(k => k.key === d.k); return alive(rec) && rec.device === d.d ? d : null;
  } catch { return null; }
}
const secure = req => process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
const limited = (ip, max) => { const f = fails.get(ip) || { n: 0, t: Date.now() }; if (Date.now() - f.t > 6e4) { f.n = 0; f.t = Date.now(); } fails.set(ip, f); return f; };
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function siteFile(name) {
  if (!NAME_RE.test(name) || PROTECTED.has(name)) return null;
  const m = meta(); if (!m.cur) return null;
  const f = path.join(SITE, m.cur, name); try { return fs.readFileSync(f); } catch { return null; }
}
async function updateApi(res, p) {
  const m = meta(), bun = bundled(), cur = m.cur || bun;
  if (p === '/api/admin/update-status') {
    const o = { current: cur, bundled: bun, previous: m.cur ? (m.prev || bun) : null, base: BASE };
    try { const r = await fetchManifest(BASE, fetch, GH); Object.assign(o, { remote: r.version, note: r.note, date: r.date, hasUpdate: cmpVer(r.version, cur) > 0 }); } catch (e) { o.error = e.message; }
    return send(res, 200, o);
  }
  if (p === '/api/admin/update') {
    try {
      const r = await fetchManifest(BASE, fetch, GH);
      if (cmpVer(r.version, cur) <= 0) return send(res, 409, { ok: false, error: 'Đang là bản mới nhất (' + cur + ')' });
      const files = await download(BASE, r, fetch, GH), dir = path.join(SITE, r.version);
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t);
      if (m.prev && m.prev !== m.cur) fs.rmSync(path.join(SITE, m.prev), { recursive: true, force: true });
      wj(METAF, { cur: r.version, prev: m.cur || '' });
      return send(res, 200, { ok: true, from: cur, to: r.version, files: Object.keys(files) });
    } catch (e) { return send(res, 502, { ok: false, error: e.message }); }
  }
  if (p === '/api/admin/rollback') {
    if (!m.cur) return send(res, 409, { ok: false, error: 'Đang dùng bản gốc, không có bản trước để quay lại' });
    wj(METAF, { cur: m.prev || '', prev: '' }); fs.rmSync(path.join(SITE, m.cur), { recursive: true, force: true });
    return send(res, 200, { ok: true, to: m.prev || bun });
  }
  return send(res, 404, {});
}
async function adminApi(req, res, p) {
  const f = limited('a:' + clientIp(req));
  if (f.n >= 10) return send(res, 429, { error: 'too_many' });
  if (!ADMIN || !eq(String(req.headers['x-admin-token'] || ''), ADMIN)) { f.n++; return send(res, 403, { error: 'forbidden' }); }
  const b = req.method === 'POST' ? await body(req) : {}, k = keys(), kk = String(b.key || '').trim().toUpperCase();
  if (p.startsWith('/api/admin/update') || p === '/api/admin/rollback') return updateApi(res, p);
  if (p === '/api/admin/list') return send(res, 200, k);
  if (p === '/api/admin/create') {
    const h = crypto.randomBytes(6).toString('hex').toUpperCase(), key = h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8), days = +b.days || 0;
    const rec = { key, name: String(b.name || '').slice(0, 80), expires: days ? new Date(Date.now() + days * DAY).toISOString().slice(0, 10) : null, active: true, device: null, created: new Date().toISOString() };
    k.push(rec); wj(KEYF, k); return send(res, 200, { key, expires: rec.expires });
  }
  if (p === '/api/admin/revoke' || p === '/api/admin/reset') {
    const rec = k.find(x => x.key === kk); if (!rec) return send(res, 404, { ok: false });
    if (p.endsWith('revoke')) rec.active = false; else rec.device = null;
    wj(KEYF, k); return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'not_found' });
}
async function login(req, res) {
  const ip = clientIp(req), f = limited(ip);
  if (f.n >= 5) return send(res, 429, { error: 'too_many' });
  const bad = (c, e) => { f.n++; return send(res, c, { error: e }); };
  const b = await body(req), key = String(b.key || '').trim().toUpperCase(), did = String(b.did || '').slice(0, 64), all = keys(), rec = all.find(x => x.key === key);
  if (!/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(key) || !did || !alive(rec)) return bad(401, 'invalid');
  if (rec.device && rec.device !== did) return bad(403, 'device');
  if (!rec.device) { rec.device = did; rec.bound = new Date().toISOString(); wj(KEYF, all); }
  const e = Math.min(Date.now() + 30 * DAY, rec.expires ? Date.parse(rec.expires + 'T23:59:59Z') : Infinity), pl = b64u(JSON.stringify({ k: key, d: did, e }));
  send(res, 200, { ok: 1 }, { 'Set-Cookie': `sid=${pl}.${sign(pl)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor((e - Date.now()) / 1000)}${secure(req)}` });
}
function serve(res, name) {
  const own = siteFile(name);
  const ext = name.split('.').pop(), types = { ...MIME, png: 'image/png' };
  let buf = own; if (!buf) { const full = path.join(PUB, name); if (!full.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); } try { buf = fs.readFileSync(full); } catch { res.writeHead(404); return res.end('Không tìm thấy'); } }
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(buf);
}
http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/api/login' && req.method === 'POST') return await login(req, res);
    if (p === '/api/logout') return send(res, 200, { ok: 1 }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    if (p === '/api/version') return send(res, 200, { version: meta().cur || bundled() });
    if (p.startsWith('/api/admin/')) return await adminApi(req, res, p);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (OPEN.has(p)) return serve(res, p.slice(1));
    const ok = !!session(req);
    if (p === '/') return serve(res, ok ? 'index.html' : 'login.html');
    if (!ok) { res.writeHead(401); return res.end('Cần đăng nhập'); }
    serve(res, p.slice(1));
  } catch (e) { console.error(e); res.writeHead(500); res.end('Lỗi máy chủ'); }
}).listen(3000, () => console.log('Phong Thuy Lac Viet chay o cong 3000, phien ban', meta().cur || bundled(), ADMIN ? '' : '(CHUA DAT ADMIN_TOKEN)'));
