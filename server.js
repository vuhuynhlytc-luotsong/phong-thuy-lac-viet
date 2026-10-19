'use strict';
// Phong Thủy Lạc Việt - máy chủ chạy trên máy của bạn, không cần key hay mật khẩu.
// - Sổ tay (năm sinh, ghi chú...) lưu ngay trên máy này (data/users/)
// - Hỏi đáp AI nhờ máy chủ chính (Cloudflare Worker) giữ key Gemini
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PUB = path.join(__dirname, 'public');
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const D_USERS = path.join(DIR, 'users');
const PORT = +process.env.PORT || 3000;
const MAX_VALUE = 2e5, MAX_TOTAL = 1e6, MAX_FIELDS = 64; // giới hạn dữ liệu sổ tay mỗi tài khoản
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
// Chỉ cập nhật file .html/.js/.css/.json trong public/. Sửa server.js hoặc Dockerfile vẫn cần ./release.sh như cũ.
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
    writeJson(F_META, next); META = next; mCache = { t: 0, m: null, e: '' };
    return { code: 200, body: { ok: true, from: cur, to: m.version, files: Object.keys(files) } };
  } catch (e) { return { code: 502, body: { ok: false, error: e.message } }; }
  finally { updBusy = false; }
}
let updBusy = false, mCache = { t: 0, m: null, e: '' };
// Xem và bấm cập nhật từ GitHub
async function userUpdate(res, p, force) {
  if (p === '/api/update/status') {
    if (force || Date.now() - mCache.t > 3e5) { try { mCache = { t: Date.now(), m: await fetchManifest(), e: '' }; } catch (e) { mCache = { t: Date.now(), m: null, e: e.message }; } }
    const cur = curVer(), m = mCache.m;
    return json(res, 200, m ? { current: cur, remote: m.version, note: m.note, date: m.date, hasUpdate: cmpVer(m.version, cur) > 0 } : { current: cur, hasUpdate: false, error: mCache.e || 'Chưa kiểm tra được' });
  }
  const r = await applyUpdate(); return json(res, r.code, r.body);
}
// ---------- tiện ích ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
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

// ---------- mã máy (chỉ để đếm lượt hỏi AI, không phải mật khẩu) ----------
const AI_URL = (process.env.AI_URL || process.env.LICENSE_URL || '').replace(/\/+$/, '');
const F_INST = path.join(DIR, 'install.json');
const INSTALL_ID = (() => {
  const o = readJson(F_INST, {});
  if (o && /^[a-f0-9]{32}$/.test(o.id)) return o.id;
  const id = crypto.randomBytes(16).toString('hex'); writeJson(F_INST, { id }); return id;
})();
const KEY = 'local';   // một máy = một sổ tay

// ---------- dữ liệu sổ tay trên máy này ----------
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

// ---------- chèn dữ liệu tài khoản vào trang (không cần gọi API lúc mở app) ----------
const esc = s => s.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function renderApp(html) {
  const inj = '<script>window.__ME={};window.__VER=' + esc(JSON.stringify(verInfo())) + ';window.__DB=' + esc(JSON.stringify(loadUser(KEY))) + ';</script>';
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
async function handleAsk(req, res) {
  if (req.method !== 'POST') return json(res, 405, {});
  const { q, h } = cleanAsk(await body(req, 2e4));
  if (!q) return json(res, 400, { error: 'empty' });
  try {
    if (AI_URL) {   // nhờ máy chủ chính (Worker) giữ key Gemini và đếm lượt
      const r = await fetch(AI_URL + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inst: INSTALL_ID, q, h }), signal: AbortSignal.timeout(40000) });
      const j = await r.json().catch(() => ({}));
      return json(res, r.ok ? 200 : (r.status === 429 ? 429 : 502), r.ok ? j : { error: j.error || 'fail', detail: j.detail });
    }
    if (!GEMINI_KEY) return json(res, 503, { error: 'off' });
    const day = new Date().toISOString().slice(0, 10), ck = day, n = askCount.get(ck) || 0;
    if (n >= ASK_LIMIT) return json(res, 429, { error: 'limit' });
    askCount.set(ck, n + 1); if (askCount.size > 5) askCount.clear();
    const o = await askGemini(q, h);
    if (o.error) askCount.set(ck, n);
    return json(res, o.error ? (o.error === 'busy' ? 429 : 502) : 200, o);
  } catch (e) { return json(res, 502, { error: 'fail' }); }
}

// ---------- xử lý yêu cầu ----------
async function handle(req, res) {
  const p = new URL(req.url, 'http://x').pathname;
  res.setHeader('X-App-Version', curVer());
  if (p === '/api/version') return json(res, 200, verInfo());

  if (p === '/api/update/status' || p === '/api/update/apply') {
    if (p === '/api/update/apply' && req.method !== 'POST') return json(res, 405, { error: 'method' });
    return userUpdate(res, p, /[?&]force=1\b/.test(req.url));
  }

  if (p === '/api/data') {
    if (req.method === 'GET') return json(res, 200, loadUser(KEY));
    if (req.method === 'PUT' || req.method === 'POST') {
      const b = await body(req, MAX_TOTAL + 1e5);
      if (b === null) return json(res, 413, { error: 'too_big' });
      const err = putUser(KEY, b);
      return err ? json(res, err === 'too_big' ? 413 : 400, { error: err }) : json(res, 200, { ok: 1 });
    }
    return json(res, 405, {});
  }
  if (p === '/api/ask') return handleAsk(req, res);

  // ---------- file tĩnh ----------
  const f = p === '/' ? '/index.html' : p;
  const full = path.join(PUB, f);
  if (!full.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  if (/(^|\/)(admin|login)\.html$/.test(f) || f === '/update.json') { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
  const own = siteFile(f.slice(1));
  fs.readFile(full, (e, d) => {
    if (own) { e = null; d = own; }
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    const ext = path.extname(full);
    if (f === '/index.html') d = renderApp(d.toString('utf8'));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(d);
  });
}

http.createServer((req, res) => {
  handle(req, res).catch(e => { console.error(e); if (!res.headersSent) json(res, 500, { error: 'server' }); else res.end(); });
}).listen(PORT, () => {
  console.log('Phong Thuy Lac Viet v' + curVer() + ' chay o cong ' + PORT);
});
