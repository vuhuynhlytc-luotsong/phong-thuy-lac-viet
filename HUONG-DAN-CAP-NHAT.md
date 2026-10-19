# Cập nhật app bằng nút "Cập nhật ngay"

## Người dùng
Khi trên GitHub có phiên bản mới, đầu trang app hiện dòng: "Có phiên bản mới vX ... [Cập nhật ngay]".
Bấm nút, app tự tải bản mới (có kiểm tra mã SHA-256) rồi tải lại trang. Không cần mật khẩu, không mất dữ liệu.
App kiểm tra khi mở trang, khi quay lại tab và mỗi 10 phút.

## Người phát hành (bạn)
1. Sửa code trong `public/` (index.html...), commit.
2. Chạy `./release.sh 1.7 "Ghi chú ngắn"` (tạo version.json, public/update.json, commit và tag).
3. `git push` rồi `git push origin v1.7`. Vài phút sau (GitHub có bộ nhớ đệm) các app sẽ hiện nút Cập nhật.

Lưu ý:
- Nút này chỉ cập nhật các file trong `public/` (giao diện). Nếu bạn sửa `server.js`, `Dockerfile` hoặc `docker-compose`,
  phải đợi GitHub Actions build ảnh mới, dán lại `solohost/docker-compose.yml` trong SoloHost rồi gỡ và cài lại app
  (gỡ app xóa dữ liệu trong volume).
- Cần có Node trên máy phát hành để `release.sh` tạo `public/update.json`. Không có thì nút Cập nhật không báo bản mới.
- App cần đặt `UPDATE_BASE` (đã có sẵn trong `solohost/docker-compose.yml`).
- Nếu bản mới lỗi: gỡ cài đặt rồi cài lại ảnh Docker cũ.
