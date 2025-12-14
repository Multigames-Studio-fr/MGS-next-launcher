param(
    [Parameter(Mandatory=$true)][string]$InstallerPath,
    [Parameter(Mandatory=$false)][string]$LauncherExePath
)

if (-not (Test-Path $InstallerPath)) {
    Write-Error "Installer not found: $InstallerPath"
    exit 2
}

try {
    $proc = Start-Process -FilePath $InstallerPath -PassThru
} catch {
    Start-Process -FilePath $InstallerPath
    $proc = $null
}

if ($proc) {
    $proc.WaitForExit()
} else {
    $basename = [System.IO.Path]::GetFileNameWithoutExtension($InstallerPath)
    while (Get-Process -Name $basename -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }
}

if ($LauncherExePath) {
    try { Start-Process -FilePath $LauncherExePath } catch { Write-Warning "Failed to start launcher: $LauncherExePath" }
} else {
    Write-Output "No launcher path provided; skipping restart."
}

# Self-delete wrapper (spawn a short-lived PowerShell to remove this file)
$self = $MyInvocation.MyCommand.Path
Start-Process -WindowStyle Hidden -FilePath powershell -ArgumentList "-NoProfile -Command Start-Sleep -Seconds 2; Remove-Item -LiteralPath '$self' -Force" | Out-Null
