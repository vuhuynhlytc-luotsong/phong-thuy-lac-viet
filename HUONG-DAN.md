# Đưa ứng dụng Lịch Âm lên solohost Pi Desktop (Docker)

Ứng dụng là 1 trang web tĩnh, chạy bằng nginx trong container. Không cần internet, không cần cơ sở dữ liệu.

## Chuẩn bị
- Máy Pi Desktop đã cài Docker và Docker Compose v2. Kiểm tra: `docker --version` và `docker compose version`
- Thư mục `lich-am` gồm: index.html, Dockerfile, nginx.conf, docker-compose.yml

## Bước 1. Chép thư mục lên máy chủ
Từ máy tính của bạn (thay `pi` và `IP_MAY` cho đúng):
    scp -r lich-am pi@IP_MAY:~/
Hoặc chép bằng USB, rồi vào thư mục: `cd ~/lich-am`

## Bước 2. Build và chạy
    cd ~/lich-am
    docker compose up -d --build

## Bước 3. Kiểm tra
    docker ps                       # thấy lich-am, trạng thái Up (healthy)
    curl http://localhost:8080      # trả về HTML
Mở trình duyệt: `http://IP_MAY:8080`. Máy khác trong cùng mạng LAN cũng truy cập được.

## Bước 4. Tự chạy lại khi máy khởi động
Compose đã đặt `restart: unless-stopped`. Chỉ cần Docker tự bật cùng hệ thống:
    sudo systemctl enable docker

## Cập nhật khi sửa index.html
    cd ~/lich-am
    docker compose up -d --build

## Xem log, dừng, xóa
    docker compose logs -f
    docker compose stop
    docker compose down

## Nếu lỗi
- Cổng 8080 bận: sửa dòng `"8080:80"` thành cổng khác (ví dụ `"8090:80"`), chạy lại bước 2.
- Máy khác không vào được: mở cổng tường lửa, ví dụ `sudo ufw allow 8080/tcp`.
- Máy Pi dùng chip ARM: ảnh nginx:alpine hỗ trợ sẵn ARM, không cần đổi gì.
- Chỉ dùng được `docker` không có `compose`: build tay
      docker build -t lich-am:1.0 .
      docker run -d --name lich-am -p 8080:80 --restart unless-stopped lich-am:1.0

## Đưa ra internet (tùy chọn)
Nên đặt sau reverse proxy có HTTPS (Caddy, Nginx Proxy Manager hoặc Cloudflare Tunnel), không mở thẳng cổng 8080 ra ngoài.
