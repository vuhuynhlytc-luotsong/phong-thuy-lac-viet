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
const OPEN = ['/login.html', '/favicon.png', '/admin.html'];
// Phiên bản app: chỉ sửa trong version.json (hoặc dùng ./release.sh). Ví dụ "1.1"
const VER = (() => {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8'));
    if (/^\d+(\.\d+){1,2}$/.test(String(v.version))) return { version: String(v.version), released: /^\d{4}-\d{2}-\d{2}$/.test(String(v.released)) ? String(v.released) : '' };
  } catch (e) { console.warn('Khong doc duoc version.json:', e.message); }
  return { version: '0.0', released: '' };
})();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.json': 'application/json' };

// ---------- cập nhật nhanh các file trong public/ từ GitHub (không cần build lại ảnh Docker) ----------
// Quy trình: sửa public/ -> .\dang-ban-moi.ps1 -Version 1.0.1 (tạo public/update.json + push) -> trang /admin.html bấm "Cập nhật ngay".
// Chỉ cập nhật file .html/.js/.css/.json trong public/ (trừ admin.html). Sửa server.js hoặc Dockerfile vẫn cần ./release.sh như cũ.
const UPDATE_BASE = (process.env.UPDATE_BASE || '').replace(/\/+$/, '');
const F_META = path.join(DIR, 'site-meta.json'), D_SITE = path.join(DIR, 'site');
const NAME_RE = /^[A-Za-z0-9._-]{1,60}\.(html|js|css|json)$/, PROTECTED = new Set(['admin.html', 'update.json']);
const VER_RE = /^\d{1,3}(\.\d{1,3}){1,2}$/, BASE_RE = /^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/[\w./-]+$/;
const vparts = v => { const a = String(v).split('.').map(Number); while (a.length < 3) a.push(0); return a; };
const cmpVer = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const BUNDLED = (() => {            // số phiên bản của bản đóng gói trong ảnh Docker (version.json hoặc public/update.json, lấy số lớn hơn)
  let b = '';
  try { const v = JSON.parse(fs.readFileSync(path.join(PUB, 'update.json'), 'utf8')).version; if (VER_RE.test(String(v))) b = String(v); } catch (e) { /* không có thì thôi */ }
  return b && cmpVer(b, VER.version) > 0 ? b : VER.version;
})();
let META = (() => {
  let m = { cur: '', prev: '', date: '' };
  try { m = Object.assign(m, JSON.parse(fs.readFileSync(F_META, 'utf8'))); } catch (e) { /* chưa có */ }
  if (m.cur && cmpVer(m.cur, BUNDLED) <= 0) {   // ảnh Docker mới hơn hoặc bằng bản đã cập nhật từ xa -> bỏ bản cũ, dùng bản đóng gói
    console.log('Ban dong goi v' + BUNDLED + ' moi hon ban cap nhat v' + m.cur + ', dung ban dong goi');
    try { fs.rmSync(D_SITE, { recursive: true, force: true }); fs.rmSync(F_META, { force: true }); } catch (e) { /* bỏ qua */ }
    m = { cur: '', prev: '', date: '' };
  }
  return m;
})();
const curVer = () => META.cur || BUNDLED;
const verInfo = () => ({ version: curVer(), released: META.cur ? META.date : VER.released });
function siteFile(name) {
  if (!META.cur || !NAME_RE.test(name) || PROTECTED.has(name)) return null;
  try { return fs.readFileSync(path.join(D_SITE, META.cur, name)); } catch (e) { return null; }
}
const norm = t => t.replace(/\r\n/g, '\n');
const sha256 = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
async function ghGet(url) {
  const r = await fetch(url + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Không tải được ' + url.split('/').pop() + ' (HTTP ' + r.status + ')');
  return r.text();
}
async function fetchManifest() {
  if (!BASE_RE.test(UPDATE_BASE)) throw new Error('UPDATE_BASE chưa đặt hoặc sai. Dạng đúng: https://raw.githubusercontent.com/<tài-khoản>/<repo>/main/public');
  let m; try { m = JSON.parse(await ghGet(UPDATE_BASE + '/update.json')); } catch (e) { throw new Error(/^Không tải/.test(e.message) ? e.message : 'update.json không đọc được'); }
  if (!m || !VER_RE.test(String(m.version))) throw new Error('update.json thiếu số phiên bản dạng 1.0.1');
  return { version: String(m.version), note: String(m.note || '').slice(0, 300), date: /^\d{4}-\d{2}-\d{2}$/.test(String(m.date)) ? String(m.date) : '', files: m.files && typeof m.files === 'object' ? m.files : {} };
}
async function downloadFiles(m) {
  const names = Object.keys(m.files);
  if (!names.length || names.length > 20) throw new Error('Danh sách file trong update.json không hợp lệ');
  if (!m.files['index.html']) throw new Error('update.json phải có index.html');
  const out = {};
  for (const n of names) {
    if (!NAME_RE.test(n) || PROTECTED.has(n)) throw new Error('Tên file không được phép cập nhật: ' + n);
    const t = norm(await ghGet(UPDATE_BASE + '/' + n));
    if (t.length > 2e6) throw new Error(n + ' quá lớn (tối đa 2 MB)');
    if (sha256(t) !== String(m.files[n]).toLowerCase()) throw new Error('Sai mã kiểm tra ' + n + '. GitHub có thể chưa cập nhật xong, đợi vài phút rồi thử lại.');
    out[n] = t;
  }
  const h = out['index.html'];
  if (!/<\/html>\s*$/i.test(h) || !/<title>/i.test(h)) throw new Error('index.html trông không hoàn chỉnh, đã hủy cập nhật');
  if (!h.includes('<!--SERVER_DATA-->')) throw new Error('index.html thiếu dòng <!--SERVER_DATA-->, nếu cập nhật sẽ mất ghi chú theo tài khoản. Đã hủy.');
  return out;
}
async function applyUpdate() {      // tải bản mới từ GitHub, kiểm tra mã SHA-256, rồi chuyển sang dùng. Trả {code, body}
  if (updBusy) return { code: 409, body: { ok: false, error: 'Đang cập nhật, vui lòng đợi' } };
  updBusy = true;
  try {
    const cur = curVer(), m = await fetchManifest();
    if (cmpVer(m.version, cur) <= 0) return { code: 409, body: { ok: false, error: 'Đang là bản mới nhất (' + cur + ')', to: cur } };
    const files = await downloadFiles(m), dir = path.join(D_SITE, m.version);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t);
    if (META.prev && META.prev !== META.cur) fs.rmSync(path.join(D_SITE, META.prev), { recursive: true, force: true });
    const next = { cur: m.version, prev: META.cur || '', date: m.date };
    writeJson(F_META, next); META = next; mCache = { t: 0, m: null };
    return { code: 200, body: { ok: true, from: cur, to: m.version, files: Object.keys(files) } };
  } catch (e) { return { code: 502, body: { ok: false, error: e.message } }; }
  finally { updBusy = false; }
}
let updBusy = false, mCache = { t: 0, m: null };
// Người dùng đã đăng nhập (không cần ADMIN_TOKEN) xem và bấm cập nhật từ GitHub
async function userUpdate(res, p) {
  if (p === '/api/update/status') {
    if (Date.now() - mCache.t > 3e5) { try { mCache = { t: Date.now(), m: await fetchManifest() }; } catch (e) { mCache = { t: Date.now(), m: null }; } }
    const cur = curVer(), m = mCache.m;
    return json(res, 200, m ? { current: cur, remote: m.version, note: m.note, date: m.date, hasUpdate: cmpVer(m.version, cur) > 0 } : { current: cur, hasUpdate: false });
  }
  const r = await applyUpdate(); return json(res, r.code, r.body);
}
async function updateApi(res, p) {
  const cur = curVer();
  if (p === '/api/admin/update-status') {
    const o = { current: cur, bundled: BUNDLED, previous: META.cur ? (META.prev || BUNDLED) : null, base: UPDATE_BASE };
    try { const m = await fetchManifest(); Object.assign(o, { remote: m.version, note: m.note, date: m.date, hasUpdate: cmpVer(m.version, cur) > 0 }); } catch (e) { o.error = e.message; }
    return json(res, 200, o);
  }
  if (p === '/api/admin/update') { const r = await applyUpdate(); return json(res, r.code, r.body); }
  if (p === '/api/admin/rollback') {
    if (!META.cur) return json(res, 409, { ok: false, error: 'Đang dùng bản đóng gói, không có bản trước để quay lại' });
    const old = META.cur, next = { cur: META.prev || '', prev: '', date: '' };
    writeJson(F_META, next); META = next; fs.rmSync(path.join(D_SITE, old), { recursive: true, force: true });
    return json(res, 200, { ok: true, to: curVer() });
  }
  return json(res, 404, {});
}

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

// ---------- chế độ có bản quyền: key do máy chủ chính (Cloudflare Worker) cấp ----------
const LICENSE_URL = (process.env.LICENSE_URL || '').replace(/\/+$/, '');
const RECHECK_MS = 36e5, GRACE_MS = 7 * 864e5;                  // hỏi lại máy chính mỗi 1 giờ; mất mạng thì cho dùng tối đa 7 ngày
const F_INST = path.join(DIR, 'install.json');
const INSTALL_ID = (() => {
  if (!LICENSE_URL) return '';
  const o = readJson(F_INST, {});
  if (o && /^[a-f0-9]{32}$/.test(o.id)) return o.id;
  const id = crypto.randomBytes(16).toString('hex'); writeJson(F_INST, { id }); return id;
})();
async function licenseCheck(key) {    // -> {st:'ok',name,expires} | {st:'invalid'} | {st:'device'} | {st:'offline'}
  try {
    const r = await fetch(LICENSE_URL + '/api/license/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, inst: INSTALL_ID }), signal: AbortSignal.timeout(10000) });
    if (r.ok) { const o = await r.json(); return { st: 'ok', name: String(o.name || ''), expires: o.expires || null }; }
    if (r.status === 403) return { st: 'device' };
    if (r.status === 401 || r.status === 404) return { st: 'invalid' };
    return { st: 'offline' };
  } catch (e) { return { st: 'offline' }; }
}
const rechecking = new Set();
function recheck(key) {               // chạy nền, không chặn người dùng
  if (rechecking.has(key)) return; rechecking.add(key);
  licenseCheck(key).then(c => {
    if (c.st === 'offline') return;
    const keys = loadKeys(), k = keys.find(x => x.key === key); if (!k) return;
    if (c.st === 'ok') { k.active = true; k.name = c.name; k.expires = c.expires; k.checked = Date.now(); } else k.active = false;
    saveKeys(keys);
  }).catch(() => {}).finally(() => rechecking.delete(key));
}

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
  if (LICENSE_URL) {
    const age = Date.now() - (k.checked || 0);
    if (age > GRACE_MS) { delete sess[h]; saveSess(); return null; }   // quá lâu không xác nhận được với máy chính
    if (age > RECHECK_MS) recheck(k.key);
  }
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
  const inj = '<script>window.__ME=' + esc(JSON.stringify(me)) + ';window.__VER=' + esc(JSON.stringify(verInfo())) + ';window.__DB=' + esc(JSON.stringify(loadUser(k.key))) + ';</script>';
  return html.replace('<!--SERVER_DATA-->', () => inj);   // dùng hàm để ký tự $ trong dữ liệu không bị hiểu nhầm
}

// ---------- hỏi đáp AI (Gemini) ----------
const GEMINI_KEY = process.env.GEMINI_API_KEY || '', GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ASK_LIMIT = +process.env.ASK_LIMIT || 20;                  // số câu hỏi / key / ngày (khi máy này tự giữ key Gemini)
const SYS_PROMPT = 'Bạn là trợ lý phong thủy và lịch âm Việt Nam trong ứng dụng "Phong Thủy Lạc Việt". Trả lời bằng tiếng Việt, ngắn gọn (tối đa khoảng 200 từ), dễ hiểu. Đây là kiến thức truyền thống để tham khảo: không khẳng định chắc chắn, không đưa lời khuyên y tế, tài chính hay pháp lý. Chỉ trả lời về phong thủy, lịch âm, ngày giờ tốt xấu, tuổi hợp, hướng nhà, văn hóa tín ngưỡng Việt; chủ đề khác thì từ chối lịch sự. Thiếu thông tin (như năm sinh) thì hỏi lại.';
const askCount = new Map();
const cleanAsk = b => {
  const q = String((b && b.q) || '').trim().slice(0, 500);
  const h = (Array.isArray(b && b.h) ? b.h : []).slice(-6).filter(x => x && (x.r === 'u' || x.r === 'm') && typeof x.t === 'string').map(x => ({ r: x.r, t: x.t.slice(0, 2000) }));
  return { q, h };
};
async function askGemini(q, h) {
  const contents = [...h.map(x => ({ role: x.r === 'u' ? 'user' : 'model', parts: [{ text: x.t }] })), { role: 'user', parts: [{ text: q }] }];
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(GEMINI_MODEL) + ':generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS_PROMPT }] }, contents, generationConfig: { maxOutputTokens: 1500, temperature: 0.7, ...(/2\.5-flash/.test(GEMINI_MODEL) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } })
  });
  if (r.status === 429) return { error: 'busy' };
  if (!r.ok) { const e = await r.json().catch(() => ({})); return { error: 'fail', detail: 'Gemini trả mã ' + r.status + (e.error && e.error.message ? ': ' + String(e.error.message).slice(0, 160) : '') }; }
  const j = await r.json().catch(() => ({}));
  const t = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map(x => x.text || '').join('').trim();
  return t ? { answer: t } : { error: 'fail', detail: 'Gemini không trả nội dung' };
}
async function handleAsk(req, res, a) {
  if (!a) return json(res, 401, { error: 'login' });
  if (req.method !== 'POST') return json(res, 405, {});
  const { q, h } = cleanAsk(await body(req, 2e4));
  if (!q) return json(res, 400, { error: 'empty' });
  try {
    if (LICENSE_URL) {   // máy con: nhờ máy chủ chính (Worker) giữ key Gemini và đếm lượt
      const r = await fetch(LICENSE_URL + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: a.k.key, inst: INSTALL_ID, q, h }), signal: AbortSignal.timeout(40000) });
      const j = await r.json().catch(() => ({}));
      return json(res, r.ok ? 200 : (r.status === 429 ? 429 : r.status === 401 || r.status === 403 ? 403 : 502), r.ok ? j : { error: j.error || 'fail', detail: j.detail });
    }
    if (!GEMINI_KEY) return json(res, 503, { error: 'off' });
    const day = new Date().toISOString().slice(0, 10), ck = a.k.key + '|' + day, n = askCount.get(ck) || 0;
    if (n >= ASK_LIMIT) return json(res, 429, { error: 'limit' });
    askCount.set(ck, n + 1); if (askCount.size > 5000) askCount.clear();
    const o = await askGemini(q, h);
    if (o.error) askCount.set(ck, n);
    return json(res, o.error ? (o.error === 'busy' ? 429 : 502) : 200, o);
  } catch (e) { return json(res, 502, { error: 'fail' }); }
}

// ---------- xử lý yêu cầu ----------
async function handle(req, res) {
  const p = new URL(req.url, 'http://x').pathname, ip = clientIp(req);
  res.setHeader('X-App-Version', curVer());
  if (p === '/api/version') return json(res, 200, verInfo());   // công khai, không cần đăng nhập

  if (p === '/api/login' && req.method === 'POST') {
    const f = fails.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 6e4) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 5) return json(res, 429, { error: 'too_many' });
    const key = String(((await body(req)) || {}).key || '').trim().toUpperCase();
    let keys = loadKeys(), k = keys.find(x => x.key === key), did = '', dh = 'lic', newDid = false;
    if (LICENSE_URL) {
      if (!/^[0-9A-Z-]{12,40}$/.test(key)) { f.n++; fails.set(ip, f); return json(res, 401, { error: 'invalid' }); }
      const c = await licenseCheck(key);
      if (c.st === 'device') { f.n++; fails.set(ip, f); return json(res, 403, { error: 'device_locked' }); }
      if (c.st === 'invalid') { f.n++; fails.set(ip, f); if (k) { k.active = false; saveKeys(keys); } return json(res, 401, { error: 'invalid' }); }
      if (c.st === 'offline') {
        if (!k || !alive(k) || Date.now() - (k.checked || 0) > GRACE_MS) return json(res, 503, { error: 'offline' });
      } else {
        if (!k) { k = { key }; keys.push(k); }
        Object.assign(k, { name: c.name, expires: c.expires, active: true, device: 'lic', checked: Date.now() });
      }
    } else {
      if (!alive(k)) { f.n++; fails.set(ip, f); return json(res, 401, { error: 'invalid' }); }
      // Mã máy: cookie "did" ngẫu nhiên, lưu lâu dài trong trình duyệt của máy này
      did = cookie(req, 'did'); newDid = !/^[a-f0-9]{48}$/.test(did);
      if (newDid) did = crypto.randomBytes(24).toString('hex');
      dh = sha(did);
      if (k.device && k.device !== dh) return json(res, 403, { error: 'device_locked' });   // key đã dùng ở máy khác
      if (!k.device) { k.device = dh; k.boundAt = new Date().toISOString(); }                // lần đầu: khóa key vào máy này
    }
    k.lastLogin = new Date().toISOString(); saveKeys(keys);

    const id = crypto.randomBytes(24).toString('hex');
    sess[sha(id)] = { key: k.key, dh, t: Date.now() }; saveSess();
    return json(res, 200, { ok: 1 }, { 'Set-Cookie': LICENSE_URL ? [setCk(req, 'sid', id, SESSION_MS / 1000)] : [setCk(req, 'sid', id, SESSION_MS / 1000), setCk(req, 'did', did, 315360000)] });
  }

  if (p === '/api/logout') {
    const id = cookie(req, 'sid'); if (id) { delete sess[sha(id)]; saveSess(); }
    return json(res, 200, { ok: 1 }, { 'Set-Cookie': setCk(req, 'sid', '', 0) });
  }

  if (p.startsWith('/api/admin/')) {
    if (!ADMIN || ADMIN === PLACEHOLDER) return json(res, 503, { error: 'admin_disabled', hint: 'Hay dat ADMIN_TOKEN rieng trong file .env' });
    const af = fails.get('a:' + ip) || { n: 0, t: Date.now() };
    if (Date.now() - af.t > 6e4) { af.n = 0; af.t = Date.now(); }
    if (af.n >= 10) return json(res, 429, { error: 'too_many' });
    if (!same(req.headers['x-admin-token'] || '', ADMIN)) { af.n++; fails.set('a:' + ip, af); return json(res, 403, { error: 'forbidden' }); }
    if (p === '/api/admin/update-status' || p === '/api/admin/update' || p === '/api/admin/rollback') return updateApi(res, p);
    const keys = loadKeys(), b = req.method === 'POST' ? ((await body(req)) || {}) : {};
    const find = () => keys.find(x => x.key === String(b.key || '').trim().toUpperCase());
    if (LICENSE_URL && /^\/api\/admin\/(list|create|revoke|restore|unbind)$/.test(p)) return json(res, 403, { error: 'licensed', hint: 'Key do máy chủ chính cấp và quản lý. Máy này không tạo được key.' });
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

  if (p === '/api/update/status' || p === '/api/update/apply') {
    if (!a) return json(res, 401, { error: 'login' });
    if (p === '/api/update/apply' && req.method !== 'POST') return json(res, 405, { error: 'method' });
    return userUpdate(res, p);
  }

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
  if (p === '/api/ask') return handleAsk(req, res, a);
  if (p === '/api/me') return a ? json(res, 200, { name: a.k.name || '', expires: a.k.expires || null }) : json(res, 401, { error: 'login' });

  // ---------- file tĩnh ----------
  const f = p === '/' ? (a ? '/index.html' : '/login.html') : p;
  if (!OPEN.includes(f) && !a) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Cần đăng nhập'); }
  const full = path.join(PUB, f);
  if (!full.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  const own = siteFile(f.slice(1));
  fs.readFile(full, (e, d) => {
    if (own) { e = null; d = own; }
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
  console.log('Phong Thuy Lac Viet v' + curVer() + ' chay o cong ' + PORT);
  if (!LICENSE_URL && (!ADMIN || ADMIN === PLACEHOLDER)) console.warn('CANH BAO: ADMIN_TOKEN chua duoc dat (hoac con la gia tri mau). Chuc nang quan tri dang TAT.');
});
