$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build-assets.ps1')
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'Install Visual Studio Build Tools with Desktop development with C++.' }
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
$binaryDirectory = Join-Path $projectDirectory 'native\bin'
New-Item -ItemType Directory -Force -Path $binaryDirectory | Out-Null
Push-Location $binaryDirectory
try {
  # cmd initializes the C++ compiler environment only; all file management uses PowerShell.
  foreach ($module in @('desktop-bridge', 'launcher')) {
    $source = Join-Path $projectDirectory "native\$module.cpp"
    $output = if ($module -eq 'launcher') { 'calendar.exe' } else { 'desktop-bridge.exe' }
    $compile = "`"$vcvars`" && cl /nologo /std:c++17 /EHsc /O2 /MT `"$source`" /Fe:`"$output`" /link user32.lib advapi32.lib"
    & $env:ComSpec /d /s /c $compile
    if ($LASTEXITCODE -ne 0) { throw "Native build failed: $module" }
  }
} finally { Pop-Location }
