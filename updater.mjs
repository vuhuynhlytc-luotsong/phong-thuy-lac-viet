// Lõi cập nhật: tải bản mới từ GitHub, kiểm tra mã SHA-256 rồi mới cho dùng.
const BASE_RE = /^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/[\w./-]+$/;
export const NAME_RE = /^[A-Za-z0-9._-]{1,60}\.(html|js|css|json)$/;
export const PROTECTED = new Set(['admin.html', 'version.json']); // không bao giờ cập nhật từ xa, để luôn còn đường quay lại
const VER_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
export const norm = s => s.replace(/\r\n/g, '\n');
export const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
export const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');

export function checkBase(base) {
  base = String(base || '').replace(/\/+$/, '');
  if (!BASE_RE.test(base)) throw new Error('UPDATE_BASE chưa đặt hoặc sai. Dạng đúng: https://raw.githubusercontent.com/<tài-khoản>/<repo>/main/public');
  return base;
}
async function get(url, f, headers) {
  const r = await f(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { headers: { 'Cache-Control': 'no-cache', ...headers } });
  if (!r.ok) throw new Error('Không tải được ' + url.split('/').pop().split('?')[0] + ' (HTTP ' + r.status + ')');
  return r.text();
}
export async function fetchManifest(base, f = fetch, headers = {}) {
  base = checkBase(base);
  let m; try { m = JSON.parse(await get(base + '/version.json', f, headers)); } catch (e) { throw new Error(e.message.startsWith('Không') ? e.message : 'version.json không đọc được'); }
  if (!m || !VER_RE.test(String(m.version))) throw new Error('version.json thiếu số phiên bản dạng 1.2.3');
  return { version: m.version, note: String(m.note || '').slice(0, 300), date: String(m.date || '').slice(0, 30), files: m.files || {} };
}
export async function download(base, m, f = fetch, headers = {}) {
  base = checkBase(base);
  const names = Object.keys(m.files);
  if (!names.length || names.length > 20) throw new Error('Danh sách file trong version.json không hợp lệ');
  if (!m.files['index.html']) throw new Error('version.json phải có index.html');
  const out = {};
  for (const n of names) {
    if (!NAME_RE.test(n) || PROTECTED.has(n)) throw new Error('Tên file không được phép cập nhật: ' + n);
    const t = norm(await get(base + '/' + n, f, headers));
    if (t.length > 2e6) throw new Error(n + ' quá lớn (tối đa 2 MB)');
    if ((await sha256(t)) !== String(m.files[n]).toLowerCase()) throw new Error('Sai mã kiểm tra ' + n + '. GitHub có thể chưa cập nhật xong, đợi vài phút rồi thử lại.');
    out[n] = t;
  }
  if (!/<\/html>\s*$/i.test(out['index.html']) || !/<title>/i.test(out['index.html'])) throw new Error('index.html trông không hoàn chỉnh, đã hủy cập nhật');
  return out;
}
export const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8' };
