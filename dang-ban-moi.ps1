# Chạy trong thư mục dự án:  .\dang-ban-moi.ps1 -Version 1.1.0 -Note "Them tinh nang X"
# Tự tạo public\update.json (kèm mã kiểm tra) rồi commit và push lên GitHub.
param([Parameter(Mandatory=$true)][ValidatePattern('^\d{1,3}\.\d{1,3}\.\d{1,3}$')][string]$Version,
      [string]$Note = "", [switch]$KhongPush)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$files = [ordered]@{}
Get-ChildItem public -File | Where-Object { $_.Extension -match '^\.(html|js|css|json)$' -and $_.Name -notin @('admin.html','update.json') } | Sort-Object Name | ForEach-Object {
  $t = ([IO.File]::ReadAllText($_.FullName, $utf8)) -replace "`r`n", "`n"
  $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($utf8.GetBytes($t))).Replace('-','').ToLower()
  $files[$_.Name] = $hash
}
$obj = [ordered]@{ version = $Version; note = $Note; date = (Get-Date -Format 'yyyy-MM-dd'); files = $files }
$json = ($obj | ConvertTo-Json -Depth 4) -replace "`r`n", "`n"
[IO.File]::WriteAllText((Join-Path (Get-Location) 'public\update.json'), $json + "`n", $utf8)
Write-Host "Da tao public\update.json - phien ban $Version ($($files.Count) file)"
if (-not $KhongPush) {
  git add -A
  git commit -m "v$Version $Note"
  git push origin main
  Write-Host "Da day len GitHub. Doi khoang 1-5 phut, vao trang quan tri bam Cap nhat."
}
