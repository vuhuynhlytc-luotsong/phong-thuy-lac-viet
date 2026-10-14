# Cấp key (mô hình admin chính)

- **Máy chủ chính** = Cloudflare Worker (phong-thuy-lac-viet.vuhuynh-lytc.workers.dev). Chỉ nơi này tạo, thu hồi, đổi máy cho key.
- Key dạng 24 ký tự: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. 1 key = 1 máy cài app.
- Máy cài app trên SoloHost/Pi (biến LICENSE_URL trong docker-compose) khi đăng nhập sẽ hỏi Worker. Máy đó **không tạo được key** (trang /admin.html chỉ còn phần cập nhật).
- Thu hồi key trên Worker: tối đa ~1 giờ sau, máy cài sẽ bị khóa. Mất mạng: máy cài vẫn dùng được tối đa 7 ngày.
- Cấp key: mở https://phong-thuy-lac-viet.vuhuynh-lytc.workers.dev/admin.html → ADMIN_TOKEN của Worker → Tạo key → gửi key cho người cài.
- Muốn người đó chuyển sang máy khác: bấm "Đổi máy" cho key đó trên Worker.

# Hỏi đáp AI (Gemini)
- Key Gemini CHỈ đặt ở Worker (secret GEMINI_API_KEY). Máy Pi/SoloHost gọi qua Worker, không cần key riêng.
- Mỗi key người dùng tối đa 20 câu hỏi/ngày (đổi bằng biến ASK_LIMIT trên Worker). Model mặc định gemini-2.5-flash (đổi bằng biến GEMINI_MODEL nếu Google đổi tên model).
