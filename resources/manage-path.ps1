param([Parameter(Mandatory)][string]$Directory, [ValidateSet('Add','Remove')][string]$Action)
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
$existing = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($existing -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $target })
if ($Action -eq 'Add') { $parts += $target }
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
