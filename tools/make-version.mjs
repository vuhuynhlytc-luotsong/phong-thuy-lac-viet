// Dùng khi có Node: node tools/make-version.mjs 1.1.0 "Ghi chú"
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const [ver, note = ''] = process.argv.slice(2);
if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ver || '')) { console.error('Dùng: node tools/make-version.mjs 1.1.0 "Ghi chú"'); process.exit(1); }
const dir = path.resolve('public'), files = {};
for (const n of fs.readdirSync(dir).sort()) {
  if (!/\.(html|js|css|json)$/.test(n) || n === 'admin.html' || n === 'version.json') continue;
  files[n] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, n), 'utf8').replace(/\r\n/g, '\n').replace(/^﻿/, '')).digest('hex');
}
fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version: ver, note, date: new Date().toISOString().slice(0, 10), files }, null, 2) + '\n');
console.log('Đã tạo public/version.json, phiên bản', ver, '\n', Object.keys(files).join(', '));
