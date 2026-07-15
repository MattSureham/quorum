param(
  [string]$TargetTriple = "x86_64-pc-windows-msvc",
  [string]$OutputRoot = "dist-portable/windows-x64"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $repoRoot "apps/desktop/src-tauri/target/$TargetTriple/release"
$desktopExe = Join-Path $releaseDir "quorum-desktop.exe"
$sidecarExe = Join-Path $repoRoot "dist-sidecar/bun/quorum-sidecar.exe"
$portableDir = Join-Path $repoRoot $OutputRoot
$archivePath = "$portableDir.zip"
$checksumPath = "$archivePath.sha256"

foreach ($requiredFile in @($desktopExe, $sidecarExe)) {
  if (-not (Test-Path -Path $requiredFile -PathType Leaf)) {
    throw "Required portable build input was not found: $requiredFile"
  }
}

if (Test-Path $portableDir) {
  Remove-Item -Path $portableDir -Recurse -Force
}
if (Test-Path $archivePath) {
  Remove-Item -Path $archivePath -Force
}

$sidecarDir = Join-Path $portableDir "sidecars"
New-Item -ItemType Directory -Path $sidecarDir -Force | Out-Null
Copy-Item -Path $desktopExe -Destination (Join-Path $portableDir "Quorum.exe")
Copy-Item -Path $sidecarExe -Destination (Join-Path $sidecarDir "quorum-sidecar.exe")

$readme = @"
Quorum Portable for Windows x64
================================

1. Extract the entire ZIP to a writable folder.
2. Do not copy a new Quorum.exe over an older portable folder. Quorum.exe and sidecars\quorum-sidecar.exe must come from the same ZIP.
3. Double-click Quorum.exe. Keep the sidecars folder beside it.
4. Windows may show an Unknown publisher or SmartScreen warning because this test build is unsigned.

Requirements:
- Windows 10 or Windows 11, x64
- Microsoft Edge WebView2 Runtime (included with current Windows 10/11 installations)

Quorum stores session data locally. Keep backups of important sessions before deleting application or data folders.
"@
Set-Content -Path (Join-Path $portableDir "README.txt") -Value $readme -Encoding UTF8

Compress-Archive -Path $portableDir -DestinationPath $archivePath -CompressionLevel Optimal
$hash = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path $checksumPath -Value "$hash  $(Split-Path -Leaf $archivePath)" -Encoding ASCII

Write-Host "Portable directory: $portableDir"
Write-Host "Portable archive:   $archivePath"
Write-Host "SHA-256:            $hash"
