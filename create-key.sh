#!/bin/sh
# Quản lý key đăng nhập.
#   ./create-key.sh create "Tên khách" 30     tạo key (30 = số ngày, bỏ trống = vô thời hạn)
#   ./create-key.sh "Tên khách" 30            (cách cũ, vẫn dùng được)
#   ./create-key.sh list                      xem danh sách key, máy đã khóa, lần đăng nhập cuối
#   ./create-key.sh unbind ABCD-1234-EF56     gỡ khóa máy (để khách đổi sang máy mới)
#   ./create-key.sh revoke ABCD-1234-EF56     thu hồi key
#   ./create-key.sh restore ABCD-1234-EF56    bật lại key đã thu hồi
# Đọc ADMIN_TOKEN từ biến môi trường hoặc file .env cùng thư mục. Đổi địa chỉ: APP_URL=https://ten-mien ./create-key.sh list
cd "$(dirname "$0")" || exit 1
[ -z "$ADMIN_TOKEN" ] && [ -f .env ] && ADMIN_TOKEN=$(sed -n 's/^ADMIN_TOKEN=//p' .env | head -n1 | tr -d '\r"')
[ -z "$ADMIN_TOKEN" ] && { echo "Chưa có ADMIN_TOKEN (đặt trong file .env)" >&2; exit 1; }
URL=${APP_URL:-http://localhost:8080}
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
call() { curl -s -X POST "$URL/api/admin/$1" -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d "$2"; echo; }
case "$1" in
  list)    curl -s "$URL/api/admin/list" -H "x-admin-token: $ADMIN_TOKEN"; echo ;;
  unbind|revoke|restore)
           [ -z "$2" ] && { echo "Thiếu mã key" >&2; exit 1; }
           call "$1" "{\"key\":\"$(esc "$2")\"}" ;;
  create)  shift; call create "{\"name\":\"$(esc "$1")\",\"days\":${2:-0}}" ;;
  *)       call create "{\"name\":\"$(esc "$1")\",\"days\":${2:-0}}" ;;
esac
