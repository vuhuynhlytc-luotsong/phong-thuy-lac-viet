# Phong Thủy Lạc Việt: đăng nhập bằng key, 1 key = 1 máy, sổ tay riêng từng tài khoản

## Cách hoạt động

- **1 key = 1 tài khoản = 1 máy.** Máy (trình duyệt) đăng nhập đầu tiên bằng key sẽ được khóa vào key đó.
  Máy khác nhập cùng key sẽ bị từ chối: "Key này đã được dùng trên máy khác".
- **Sổ tay lưu riêng theo key trên máy chủ** (`data/users/`): ngày quan trọng, nhắc giờ/ngày, năm sinh đã nhập.
  Xóa dữ liệu trình duyệt cũng không mất ghi chú. Key này không thấy ghi chú của key kia.
- Ghi chú cũ đang nằm trong trình duyệt (bản chưa có tài khoản) được **tự nhập 1 lần** vào tài khoản ngay lần đăng nhập đầu.
- Thu hồi key hoặc hết hạn thì đăng xuất ngay ở lượt truy cập kế tiếp. Phiên đăng nhập được lưu nên khởi động lại server không làm khách bị đăng xuất.

## Cài đặt

```bash
cp .env.example .env
# mở .env, đặt ADMIN_TOKEN là chuỗi bí mật dài (tạo nhanh: openssl rand -hex 24)
docker compose up -d --build
```

App chạy ở `http://localhost:8080`. Thư mục `data/` chứa toàn bộ key và sổ tay, **hãy sao lưu thư mục này**.

> Nếu `ADMIN_TOKEN` trống hoặc còn là giá trị mẫu `DOI-CHUOI-BI-MAT-DAI-O-DAY`, chức năng quản trị tự tắt để tránh bị lộ.

## Quản lý key

```bash
./create-key.sh create "Chị Lan" 30     # tạo key 30 ngày (bỏ số ngày = vô thời hạn)
./create-key.sh list                    # xem key, đã khóa máy chưa, lần đăng nhập cuối
./create-key.sh unbind ABCD-1234-EF56   # gỡ khóa máy để khách đổi sang máy mới (giữ nguyên sổ tay)
./create-key.sh revoke ABCD-1234-EF56   # thu hồi
./create-key.sh restore ABCD-1234-EF56  # bật lại
```

Khi khách đổi máy: chạy `unbind`, rồi bảo khách đăng nhập lại trên máy mới. Máy cũ bị đăng xuất ngay.
Script đọc `ADMIN_TOKEN` từ `.env`. Nếu chạy ở nơi khác: `APP_URL=https://ten-mien.com ./create-key.sh list`.

## Lưu ý quan trọng

1. **"Máy" ở đây là trình duyệt**, không phải phần cứng. Máy được nhận diện bằng cookie lưu trong trình duyệt.
   Nếu khách xóa cookie, dùng trình duyệt khác hoặc chế độ ẩn danh thì bị coi là máy mới và cần `unbind`.
   Web không có cách đáng tin cậy để nhận diện phần cứng.
2. **Nên chạy sau HTTPS** (nginx, Caddy, Cloudflare). Qua HTTP thường, key và cookie đi trên mạng không mã hóa.
   Khi đó đặt `TRUST_PROXY=1` trong `.env` để chống dò key theo đúng IP khách.
3. Phải truy cập cùng một địa chỉ. `localhost`, `127.0.0.1` và địa chỉ IP/tên miền là các nơi khác nhau nên cookie không dùng chung.
4. Key mới có dạng `XXXX-XXXX-XXXX` (dài hơn trước). Key cũ dạng `XXXX-XXXX` vẫn dùng được và sẽ được khóa máy ở lần đăng nhập kế tiếp.
5. Sai key quá 5 lần trong 1 phút thì bị chặn 1 phút.

## Phiên bản và cập nhật

Số phiên bản hiện cạnh tên app (ví dụ **v1.0**, rê chuột để xem ngày phát hành) và ở trang đăng nhập.
Nguồn duy nhất là file `version.json`. Khi cần ra bản mới (ví dụ v1.1):

```bash
git add -A && git commit -m "Nội dung thay đổi"   # commit code trước
./release.sh 1.1                                  # nâng version.json, tạo commit + tag v1.1
git push && git push origin v1.1                  # GitHub Actions tự build ảnh ...:1.1
```

- `release.sh` từ chối nếu số phiên bản trùng bản hiện tại, sai định dạng, hoặc còn code chưa commit.
- Quy trình GitHub Actions báo lỗi nếu tag không khớp `version.json`, nên không thể phát hành ảnh ghi sai số.
- Khi server lên bản mới, người đang mở app sẽ thấy dải **"Đã có phiên bản mới v1.1 · Tải lại để cập nhật"**
  (kiểm tra khi quay lại tab và mỗi 10 phút). Bấm nút là lưu ghi chú rồi tải lại, không mất dữ liệu.
- Chạy Docker thường: `docker compose up -d --build` sau khi `git pull`.

## Chạy trong Pi Desktop (SoloHost)

Thư mục `solohost/` có sẵn 2 file để dán vào SoloHost. Cách làm giống hướng dẫn trước:
đẩy repo lên GitHub, tạo tag bằng `release.sh`, đặt ảnh ghcr.io ở chế độ **Public**, thay `TEN_GITHUB_CUA_BAN`
trong `solohost/docker-compose.yml`, kiểm tra bằng `scripts/validate_api.py` của kho `pi-node/solohost`.
Khi ra bản mới, `release.sh` tự ghim lại số phiên bản trong `solohost/docker-compose.yml`; bạn dán lại file đó vào SoloHost.

Pi Desktop chạy mỗi app trong container cách ly, gắn cổng vào `127.0.0.1` (chỉ truy cập từ chính máy) và dùng volume riêng.
Điều này kéo theo:

1. **Gỡ cài đặt sẽ xóa volume, nghĩa là mất toàn bộ key và sổ tay.** Cần có cách sao lưu trước khi gỡ.
2. **Mỗi lần cài là một server riêng**, có `keys.json` riêng. Key bạn tạo trên máy bạn không dùng được trên bản cài của người khác.
3. Cài mới chưa có key nào. Người cài đặt `ADMIN_TOKEN` trong form cài đặt, rồi tạo key đầu tiên:
   `ADMIN_TOKEN=... APP_URL=http://127.0.0.1:18480 ./create-key.sh create "Tên"`
4. Chưa kiểm chứng việc Pi Desktop có giữ nguyên volume khi bạn dán lại compose với số phiên bản mới.
   Hãy thử cập nhật với dữ liệu thật trước khi phát hành cho người dùng.
