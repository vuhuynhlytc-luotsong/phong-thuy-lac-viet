# Cập nhật Phong Thủy Lạc Việt bằng 1 cú bấm

## Mỗi lần có bản mới (làm trên máy Windows)
1. Sửa code trong thư mục `public\` (index.html, login.html...).
2. Mở PowerShell tại thư mục dự án, chạy:
   `.\dang-ban-moi.ps1 -Version 1.1.0 -Note "Them tinh nang X"`
   (tự tạo public\version.json rồi commit + push lên GitHub; thêm `-KhongPush` nếu chỉ muốn tạo file)
3. Đợi 1-5 phút (GitHub cập nhật bộ nhớ đệm), vào `/admin.html` -> mục "Cập nhật phiên bản" -> bấm **Cập nhật ngay**.
4. Người dùng đang mở app sẽ thấy thanh "Đã có phiên bản mới" và bấm Tải lại.

Số phiên bản phải LỚN HƠN bản đang chạy (1.0.0 -> 1.0.1 -> 1.1.0 ...). Lỗi hay bấm "Quay lại bản trước" để lùi.

## Cập nhật được gì / không được gì
- Được: mọi file trong public\ (.html .js .css .json) trừ admin.html và version.json.
- Không: server.mjs / worker.js / Dockerfile / biến môi trường. Sửa các file này thì phải publish lại như cũ (hiếm khi cần).
- Nếu thêm file mới (vd. tuoi.js) thì cũng nằm trong public\ và được script tự đưa vào version.json.
