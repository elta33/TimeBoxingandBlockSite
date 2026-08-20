#Requires -Version 5.1
<#
.SYNOPSIS
    파이어폭스용 산출물을 dist/firefox 에 생성한다.

.DESCRIPTION
    소스는 크롬/파이어폭스가 100% 공유한다. 유일한 차이는 manifest 이며, 이 스크립트가
    manifest.json(크롬용 원본)에 manifest.firefox.json(오버레이)을 얕게 병합해서 만든다.
    - background: service_worker(크롬) → scripts(파이어폭스 event page)로 통째로 교체
    - browser_specific_settings: 파이어폭스 전용 키 추가 (storage.sync 사용 시 gecko.id 필수)

    dist/ 는 생성물이므로 직접 편집하지 않는다. 수정은 항상 리포 루트의 소스에만 한다.

.PARAMETER Package
    빌드 후 AMO 제출용 zip(dist/focusbox-firefox-<version>.zip)까지 만든다.

.EXAMPLE
    powershell -File build-firefox.ps1
    powershell -File build-firefox.ps1 -Package
#>
param([switch]$Package)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out  = Join-Path $root 'dist\firefox'

# ── 1. 산출물 폴더 초기화 ──
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out -Force | Out-Null

# ── 2. 루트의 코드 파일 ──
# 확장자 화이트리스트라 *.md / *.ps1 / manifest.firefox.json 은 자동으로 빠진다.
# 루트에 새 .js/.html/.css 를 추가하면 별도 수정 없이 그대로 포함된다.
$codeFiles = Get-ChildItem -Path $root -File |
    Where-Object { @('.js', '.html', '.css') -contains $_.Extension }
$codeFiles | ForEach-Object { Copy-Item $_.FullName -Destination $out }

# ── 3. 에셋 디렉터리 ──
# 여기는 화이트리스트다. 새 디렉터리를 만들면 이 목록에도 추가해야 한다.
$assetDirs = @('icons', 'images', 'styles', '_locales')
foreach ($dir in $assetDirs) {
    $src = Join-Path $root $dir
    if (Test-Path $src) { Copy-Item $src -Destination $out -Recurse }
}

# ── 4. manifest 병합 (top-level 키 단위 얕은 병합) ──
$base  = Get-Content (Join-Path $root 'manifest.json')         -Raw -Encoding UTF8 | ConvertFrom-Json
$patch = Get-Content (Join-Path $root 'manifest.firefox.json') -Raw -Encoding UTF8 | ConvertFrom-Json

foreach ($prop in $patch.PSObject.Properties) {
    if ($base.PSObject.Properties.Name -contains $prop.Name) {
        $base.PSObject.Properties.Remove($prop.Name)
    }
    $base | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value
}

$manifestPath = Join-Path $out 'manifest.json'
$json = $base | ConvertTo-Json -Depth 20

# PowerShell 5.1의 ConvertTo-Json은 < > ' & 를 유니코드로 이스케이프한다(<all_urls>).
# JSON 스펙상 유효해서 파서는 똑같이 읽지만, AMO 리뷰어가 눈으로 읽는 파일이라 되돌려 놓는다.
$json = $json -replace '\\u003c', '<' -replace '\\u003e', '>' -replace '\\u0027', "'" -replace '\\u0026', '&'

# Set-Content -Encoding UTF8 은 5.1에서 BOM을 붙인다. manifest.json의 BOM은 파서에 따라
# 문제가 될 수 있어 BOM 없는 UTF-8로 직접 쓴다.
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))

# ── 5. 산출물 검증 ──
# 병합이 조용히 어긋나면(크롬 키가 남거나 스크립트 목록이 비면) 파이어폭스에서 background가
# 아예 안 뜨는데 원인 파악이 어렵다. 여기서 바로 실패시킨다.
$check = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($check.background.service_worker) {
    throw '빌드 실패: 파이어폭스 manifest에 크롬 전용 background.service_worker가 남아 있습니다.'
}
if (-not $check.background.scripts -or $check.background.scripts.Count -eq 0) {
    throw '빌드 실패: background.scripts가 비어 있습니다.'
}
if (-not $check.browser_specific_settings.gecko.id) {
    throw '빌드 실패: browser_specific_settings.gecko.id가 없습니다 (storage.sync에 필수).'
}
foreach ($script in $check.background.scripts) {
    if (-not (Test-Path (Join-Path $out $script))) {
        throw "빌드 실패: background.scripts에 있는 '$script' 가 산출물에 없습니다."
    }
}

$fileCount = (Get-ChildItem -Path $out -Recurse -File).Count
Write-Host "빌드 완료: $out ($fileCount 파일, version $($check.version))"

# ── 6. 선택: AMO 제출용 zip ──
if ($Package) {
    $zip = Join-Path $root ("dist\focusbox-firefox-{0}.zip" -f $check.version)
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip
    Write-Host "패키지 생성: $zip"
}

Write-Host "파이어폭스에서 확인: about:debugging#/runtime/this-firefox → '임시 부가 기능 로드' → $out\manifest.json"
