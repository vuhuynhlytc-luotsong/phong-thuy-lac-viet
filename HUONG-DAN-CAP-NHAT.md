# Cập nhật Phong Thủy Lạc Việt

## A. Sửa giao diện / thêm tính năng (public/*.html, js, css) — KHÔNG cần build lại, KHÔNG cài lại
1. Sửa file trong `public/` (trừ admin.html).
2. Trong PowerShell tại thư mục dự án:  `.\dang-ban-moi.ps1 -Version 1.1.0 -Note "Them tinh nang X"`
   (tạo public/update.json kèm mã SHA-256, commit, push lên GitHub).
3. Đợi 1–5 phút → mở `https://<địa-chỉ-app>/admin.html` → đăng nhập ADMIN_TOKEN → **Cập nhật ngay**.
   Có nút **Quay lại bản trước**. Dữ liệu key và sổ tay không bị đụng tới.
   Repo GitHub phải để **Public**.

## B. Sửa server.js hoặc Dockerfile — phải phát hành ảnh mới
`./release.sh 1.1` → `git push && git push origin v1.1` → đợi GitHub Actions xanh →
dán lại `solohost/docker-compose.yml` vào SoloHost (Edit app → Update app).
