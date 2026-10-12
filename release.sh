#!/bin/sh
# Phát hành phiên bản mới.   Dùng:  ./release.sh 1.1
# Làm 3 việc: ghi số phiên bản vào version.json, ghim lại tag ảnh trong solohost/docker-compose.yml,
# rồi (nếu là repo git) tạo commit + tag v1.1. Lệnh này KHÔNG tự đẩy lên GitHub.
set -e
cd "$(dirname "$0")"
V="${1#v}"
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+(\.[0-9]+)?$' || { echo "Dùng: ./release.sh 1.1   (dạng 1.1 hoặc 1.1.2)" >&2; exit 1; }
OLD=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' version.json 2>/dev/null | head -n1)
[ "$V" = "$OLD" ] && { echo "Phiên bản $V đang là bản hiện tại, hãy chọn số khác." >&2; exit 1; }
if [ -d .git ]; then
  git diff --quiet && git diff --cached --quiet || { echo "Còn thay đổi chưa commit. Hãy commit code trước rồi chạy lại để bản phát hành chứa đủ code." >&2; exit 1; }
  git rev-parse -q --verify "refs/tags/v$V" >/dev/null && { echo "Tag v$V đã tồn tại." >&2; exit 1; }
fi
printf '{\n  "version": "%s",\n  "released": "%s"\n}\n' "$V" "$(date +%F)" > version.json
if [ -f solohost/docker-compose.yml ]; then
  sed "s#\(phong-thuy-lac-viet:\)[0-9][0-9.]*#\1$V#" solohost/docker-compose.yml > solohost/docker-compose.yml.tmp && mv solohost/docker-compose.yml.tmp solohost/docker-compose.yml
fi
echo "Đã nâng phiên bản ${OLD:-?} -> $V"
if [ -d .git ]; then
  git add version.json
  [ -f solohost/docker-compose.yml ] && git add solohost/docker-compose.yml
  git commit -q -m "Phiên bản v$V"
  git tag "v$V"
  echo "Đã tạo commit và tag v$V. Bước tiếp theo:"
  echo "  git push && git push origin v$V    (GitHub Actions sẽ build ảnh ...:$V)"
else
  echo "Không phải repo git. Hãy tự commit và tạo tag v$V rồi đẩy lên GitHub."
fi
echo "Sau khi ảnh build xong: dán lại solohost/docker-compose.yml vào SoloHost để người dùng nhận bản $V."
