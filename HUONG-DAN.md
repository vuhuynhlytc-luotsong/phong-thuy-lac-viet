# Phong Thủy Lạc Việt (bản Pi / SoloHost)

App mở là dùng, **không cần key hay mật khẩu**. Sổ tay (năm sinh, ghi chú, nhắc ngày) lưu ngay trên máy cài app, thư mục `data/`.

## Cài đặt

- **SoloHost:** dán nội dung `solohost/docker-compose.yml` khi cài. Biến `AI_URL` trỏ tới Worker giữ key Gemini.
- **Docker thường:** `cp .env.example .env`, điền `AI_URL`, rồi `docker compose up -d --build`. App chạy ở `http://localhost:8080`.

## Hỏi đáp AI

Máy này không giữ key Gemini. Câu hỏi gửi qua Worker (`AI_URL`), Worker giữ key và giới hạn số lượt mỗi ngày cho mỗi máy.
Muốn tự dùng key riêng: đặt `GEMINI_API_KEY` và bỏ trống `AI_URL`.

## Phiên bản và cập nhật

Xem `HUONG-DAN-CAP-NHAT.md`. Ra bản mới: `./release.sh X.Y "ghi chú"`, `git push`, `git push origin vX.Y`.
