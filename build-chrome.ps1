#Requires -Version 5.1
<#
.SYNOPSIS
    크롬 웹 스토어(CWS) 제출용 산출물을 dist/chrome 에 생성한다.

.DESCRIPTION
    소스는 크롬/파이어폭스가 100% 공유한다. 크롬은 리포 루트의 manifest.json 을 그대로 쓰므로
    build-firefox.ps1 과 달리 manifest 병합 단계가 없다. 나머지 파일 선별 규칙은 동일하다.

    dist/ 는 생성물이므로 직접 편집하지 않는다. 수정은 항상 리포 루트의 소스에만 한다.

.PARAMETER Package
    빌드 후 CWS 제출용 zip(dist/FocusBox-v<version>.zip)까지 만든다.

.EXAMPLE
    powershell -File build-chrome.ps1
    powershell -File build-chrome.ps1 -Package
#>
param([switch]$Package)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out  = Join-Path $root 'dist\chrome'

# ── 1. 산출물 폴더 초기화 ──
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out -Force | Out-Null

# ── 2. 루트의 코드 파일 ──
# 확장자 화이트리스트라 *.md / *.ps1 / *.cmd / LICENSE 는 자동으로 빠진다.
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

# ── 4. manifest ──
# manifest.firefox.json 은 파이어폭스 전용 오버레이라 크롬 산출물에 들어가면 안 된다.
# 확장자 화이트리스트가 .json 을 안 잡으므로 크롬용 원본만 콕 집어 복사한다.
Copy-Item (Join-Path $root 'manifest.json') -Destination $out

# ── 5. 산출물 검증 ──
# 참조가 조용히 깨지면(파일 누락, 오타) 로드 시점이나 특정 화면에서야 터져서 원인 파악이
# 어렵다. 여기서 바로 실패시킨다.
$manifestPath = Join-Path $out 'manifest.json'
$check = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if (Test-Path (Join-Path $out 'manifest.firefox.json')) {
    throw '빌드 실패: 크롬 산출물에 파이어폭스 전용 manifest.firefox.json 이 들어갔습니다.'
}
if ($check.background.scripts) {
    throw '빌드 실패: manifest에 파이어폭스 전용 background.scripts가 있습니다.'
}
if (-not $check.background.service_worker) {
    throw '빌드 실패: background.service_worker가 없습니다.'
}

# manifest가 가리키는 파일이 실제로 담겼는지 확인한다.
$refs = @(
    $check.background.service_worker
    $check.action.default_popup
    $check.options_ui.page
)
$refs += $check.icons.PSObject.Properties.Value
foreach ($cs in $check.content_scripts) { $refs += $cs.js }

foreach ($ref in ($refs | Where-Object { $_ })) {
    if (-not (Test-Path (Join-Path $out $ref))) {
        throw "빌드 실패: manifest가 참조하는 '$ref' 가 산출물에 없습니다."
    }
}

# HTML이 로드하는 스크립트/스타일도 같이 확인한다. 상대 경로만 대상이며 http(s)· data: 는 건너뛴다.
foreach ($html in (Get-ChildItem -Path $out -Filter *.html -File)) {
    $content = Get-Content $html.FullName -Raw -Encoding UTF8
    foreach ($m in [regex]::Matches($content, '(?:src|href)="([^":]+\.(?:js|css))"')) {
        $ref = $m.Groups[1].Value
        if (-not (Test-Path (Join-Path $out $ref))) {
            throw "빌드 실패: $($html.Name) 이 참조하는 '$ref' 가 산출물에 없습니다."
        }
    }
}

$fileCount = (Get-ChildItem -Path $out -Recurse -File).Count
Write-Host "빌드 완료: $out ($fileCount 파일, version $($check.version))"

# ── 6. 선택: CWS 제출용 zip ──
if ($Package) {
    $zip = Join-Path $root ("dist\FocusBox-v{0}.zip" -f $check.version)
    if (Test-Path $zip) { Remove-Item $zip -Force }

    # Compress-Archive(및 .NET Framework의 ZipFile.CreateFromDirectory)는 하위 디렉터리
    # 엔트리를 'icons\icon16.png' 처럼 백슬래시로 기록한다. ZIP 스펙은 '/' 를 요구하므로
    # 압축 해제 도구에 따라 폴더 구조가 뭉개진다. 엔트리를 직접 써서 '/' 를 보장한다.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $archive = [System.IO.Compression.ZipFile]::Open(
        $zip, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($f in (Get-ChildItem -Path $out -Recurse -File | Sort-Object FullName)) {
            $rel = $f.FullName.Substring($out.Length + 1).Replace([char]92, '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $f.FullName, $rel,
                [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally {
        $archive.Dispose()
    }

    Write-Host "패키지 생성: $zip"
}

Write-Host "크롬에서 확인: chrome://extensions → '압축해제된 확장 프로그램을 로드합니다' → $out"
