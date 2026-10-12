'use strict';
// Phong Thủy Lạc Việt - máy chủ đăng nhập bằng key.
// - 1 key = 1 tài khoản = 1 máy (máy đăng nhập đầu tiên được "khóa" vào key)
// - Sổ tay của mỗi key được lưu riêng trên server (data/users/)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PUB = path.join(__dirname, 'public');
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const F_KEYS = path.join(DIR, 'keys.json'), F_SESS = path.join(DIR, 'sessions.json'), D_USERS = path.join(DIR, 'users');
const ADMIN = process.env.ADMIN_TOKEN || '', PLACEHOLDER = 'DOI-CHUOI-BI-MAT-DAI-O-DAY';
const PORT = +process.env.PORT || 3000;
const TRUST = process.env.TRUST_PROXY === '1';        // =1 khi chạy sau nginx/Cloudflare
const SESSION_MS = 30 * 864e5;                          // phiên đăng nhập 30 ngày
const MAX_VALUE = 2e5, MAX_TOTAL = 1e6, MAX_FIELDS = 64; // giới hạn dữ liệu sổ tay mỗi tài khoản
const OPEN = ['/login.html', '/favicon.png'];
// Phiên bản app: chỉ sửa trong version.json (hoặc dùng ./release.sh). Ví dụ "1.1"
const VER = (() => {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8'));
    if (/^\d+(\.\d+){1,2}$/.test(String(v.version))) return { version: String(v.version), released: /^\d{4}-\d{2}-\d{2}$/.test(String(v.released)) ? String(v.released) : '' };
  } catch (e) { console.warn('Khong doc duoc version.json:', e.message); }
  return { version: '0.0', released: '' };
})();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.json': 'application/json' };

// ---------- tiện ích ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => crypto.timingSafeEqual(Buffer.from(sha(String(a))), Buffer.from(sha(String(b))));
const readJson = (f, df) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return df; throw e; }   // file hỏng => báo lỗi, KHÔNG âm thầm ghi đè mất dữ liệu
};
const writeJson = (f, o) => {                                   // ghi nguyên tử: ghi file tạm rồi đổi tên
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const t = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(t, JSON.stringify(o, null, 2), { mode: 0o600 });
  fs.renameSync(t, f);
};
const json = (s, c, o, h = {}) => { s.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }); s.end(JSON.stringify(o)); };
const body = (r, max = 1e5) => new Promise(ok => {
  let b = '', big = false;
  r.on('data', c => { if (big) return; b += c; if (b.length > max) { big = true; b = ''; } });
  r.on('end', () => { if (big) return ok(null); try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
  r.on('error', () => ok({}));
});
const cookie = (r, n) => {
  for (const p of (r.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0 && p.slice(0, i).trim() === n) return p.slice(i + 1).trim(); }
  return '';
};
const isHttps = r => !!r.socket.encrypted || (TRUST && r.headers['x-forwarded-proto'] === 'https');
const setCk = (r, n, v, age) => `${n}=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${isHttps(r) ? '; Secure' : ''}`;
const clientIp = r => {
  if (TRUST) { const x = String(r.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean); if (x.length) return x[x.length - 1]; }
  return r.socket.remoteAddress || '';
};

// ---------- key ----------
const loadKeys = () => { const k = readJson(F_KEYS, []); return Array.isArray(k) ? k : []; };
const saveKeys = k => writeJson(F_KEYS, k);
const alive = k => !!k && k.active && (!k.expires || new Date(k.expires) >= new Date());

// ---------- phiên đăng nhập (lưu ra file, khởi động lại không bị đăng xuất) ----------
let sess = readJson(F_SESS, {}), sessTimer = 0;
const pruneSess = () => { const n = Date.now(); for (const h of Object.keys(sess)) if (n - sess[h].t > SESSION_MS) delete sess[h]; };
const saveSess = () => { clearTimeout(sessTimer); sessTimer = setTimeout(() => { try { pruneSess(); writeJson(F_SESS, sess); } catch (e) { console.error(e); } }, 400); };
pruneSess();

// Trả về { k, h } nếu phiên hợp lệ: key còn hạn + vẫn đúng máy đã khóa
const authed = r => {
  const id = cookie(r, 'sid');
  if (!/^[a-f0-9]{48}$/.test(id)) return null;
  const h = sha(id), s = sess[h];
  if (!s) return null;
  const k = loadKeys().find(x => x.key === s.key);
  if (!alive(k) || !k.device || k.device !== s.dh || Date.now() - s.t > SESSION_MS) { delete sess[h]; saveSess(); return null; }
  return { k, h };
};

// ---------- dữ liệu sổ tay riêng từng tài khoản ----------
const userFile = key => path.join(D_USERS, sha(key).slice(0, 32) + '.json');
const loadUser = key => { const d = readJson(userFile(key), {}); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; };
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
function putUser(key, b) {
  const d = loadUser(key), set = b && b.set && typeof b.set === 'object' && !Array.isArray(b.set) ? b.set : {};
  for (const [k, v] of Object.entries(set)) { if (!FIELD.test(k) || typeof v !== 'string' || v.length > MAX_VALUE) return 'bad_data'; d[k] = v; }
  for (const k of Array.isArray(b && b.del) ? b.del : []) if (FIELD.test(String(k))) delete d[k];
  if (Object.keys(d).length > MAX_FIELDS || JSON.stringify(d).length > MAX_TOTAL) return 'too_big';
  writeJson(userFile(key), d);
  return null;
}

// ---------- chống dò key ----------
const fails = new Map();
setInterval(() => { const n = Date.now(); for (const [ip, f] of fails) if (n - f.t > 6e4) fails.delete(ip); }, 3e5).unref();

// ---------- chèn dữ liệu tài khoản vào trang (không cần gọi API lúc mở app) ----------
const esc = s => s.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function renderApp(html, k) {
  const me = { name: k.name || '', expires: k.expires || null };
  const inj = '<script>window.__ME=' + esc(JSON.stringify(me)) + ';window.__VER=' + esc(JSON.stringify(VER)) + ';window.__DB=' + esc(JSON.stringify(loadUser(k.key))) + ';</script>';
  return html.replace('<!--SERVER_DATA-->', () => inj);   // dùng hàm để ký tự $ trong dữ liệu không bị hiểu nhầm
}

// ---------- xử lý yêu cầu ----------
async function handle(req, res) {
  const p = new URL(req.url, 'http://x').pathname, ip = clientIp(req);
  res.setHeader('X-App-Version', VER.version);
  if (p === '/api/version') return json(res, 200, VER);   // công khai, không cần đăng nhập

  if (p === '/api/login' && req.method === 'POST') {
    const f = fails.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 6e4) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 5) return json(res, 429, { error: 'too_many' });
    const key = String(((await body(req)) || {}).key || '').trim().toUpperCase();
    const keys = loadKeys(), k = keys.find(x => x.key === key);
    if (!alive(k)) { f.n++; fails.set(ip, f); return json(res, 401, { error: 'invalid' }); }

    // Mã máy: cookie "did" ngẫu nhiên, lưu lâu dài trong trình duyệt của máy này
    let did = cookie(req, 'did'); const newDid = !/^[a-f0-9]{48}$/.test(did);
    if (newDid) did = crypto.randomBytes(24).toString('hex');
    const dh = sha(did);
    if (k.device && k.device !== dh) return json(res, 403, { error: 'device_locked' });   // key đã dùng ở máy khác
    if (!k.device) { k.device = dh; k.boundAt = new Date().toISOString(); }                // lần đầu: khóa key vào máy này
    k.lastLogin = new Date().toISOString(); saveKeys(keys);

    const id = crypto.randomBytes(24).toString('hex');
    sess[sha(id)] = { key: k.key, dh, t: Date.now() }; saveSess();
    return json(res, 200, { ok: 1 }, { 'Set-Cookie': [setCk(req, 'sid', id, SESSION_MS / 1000), setCk(req, 'did', did, 315360000)] });
  }

  if (p === '/api/logout') {
    const id = cookie(req, 'sid'); if (id) { delete sess[sha(id)]; saveSess(); }
    return json(res, 200, { ok: 1 }, { 'Set-Cookie': setCk(req, 'sid', '', 0) });
  }

  if (p.startsWith('/api/admin/')) {
    if (!ADMIN || ADMIN === PLACEHOLDER) return json(res, 503, { error: 'admin_disabled', hint: 'Hay dat ADMIN_TOKEN rieng trong file .env' });
    if (!same(req.headers['x-admin-token'] || '', ADMIN)) return json(res, 403, { error: 'forbidden' });
    const keys = loadKeys(), b = req.method === 'POST' ? ((await body(req)) || {}) : {};
    const find = () => keys.find(x => x.key === String(b.key || '').trim().toUpperCase());
    if (p === '/api/admin/list') return json(res, 200, keys.map(k => ({ key: k.key, name: k.name, expires: k.expires, active: k.active, bound: !!k.device, boundAt: k.boundAt || null, lastLogin: k.lastLogin || null })));
    if (p === '/api/admin/create') {
      const h = crypto.randomBytes(6).toString('hex').toUpperCase(), key = h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8);
      const days = Math.min(Math.max(Math.floor(Number(b.days) || 0), 0), 36500);
      const e = days ? new Date(Date.now() + days * 864e5).toISOString().slice(0, 10) : null;
      keys.push({ key, name: String(b.name || '').slice(0, 80), expires: e, active: true, device: null }); saveKeys(keys);
      return json(res, 200, { key, expires: e });
    }
    const k = find();
    if (p === '/api/admin/revoke') { if (k) { k.active = false; saveKeys(keys); } return json(res, 200, { ok: !!k }); }
    if (p === '/api/admin/restore') { if (k) { k.active = true; saveKeys(keys); } return json(res, 200, { ok: !!k }); }
    if (p === '/api/admin/unbind') { if (k) { k.device = null; k.boundAt = null; saveKeys(keys); } return json(res, 200, { ok: !!k }); }  // cho phép chuyển sang máy mới
    return json(res, 404, {});
  }

  const a = authed(req);

  if (p === '/api/data') {
    if (!a) return json(res, 401, { error: 'login' });
    if (req.method === 'GET') return json(res, 200, loadUser(a.k.key));
    if (req.method === 'PUT' || req.method === 'POST') {
      const b = await body(req, MAX_TOTAL + 1e5);
      if (b === null) return json(res, 413, { error: 'too_big' });
      const err = putUser(a.k.key, b);
      return err ? json(res, err === 'too_big' ? 413 : 400, { error: err }) : json(res, 200, { ok: 1 });
    }
    return json(res, 405, {});
  }
  if (p === '/api/me') return a ? json(res, 200, { name: a.k.name || '', expires: a.k.expires || null }) : json(res, 401, { error: 'login' });

  // ---------- file tĩnh ----------
  const f = p === '/' ? (a ? '/index.html' : '/login.html') : p;
  if (!OPEN.includes(f) && !a) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Cần đăng nhập'); }
  const full = path.join(PUB, f);
  if (!full.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (e, d) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    const ext = path.extname(full);
    if (f === '/index.html' && a) d = renderApp(d.toString('utf8'), a.k);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(d);
  });
}

http.createServer((req, res) => {
  handle(req, res).catch(e => { console.error(e); if (!res.headersSent) json(res, 500, { error: 'server' }); else res.end(); });
}).listen(PORT, () => {
  console.log('Phong Thuy Lac Viet v' + VER.version + ' chay o cong ' + PORT);
  if (!ADMIN || ADMIN === PLACEHOLDER) console.warn('CANH BAO: ADMIN_TOKEN chua duoc dat (hoac con la gia tri mau). Chuc nang quan tri dang TAT.');
});
