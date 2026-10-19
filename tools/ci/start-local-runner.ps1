param(
    [string]$RunnerDirectory = (Join-Path $PSScriptRoot '../../.build/self-hosted-runner')
)
$ErrorActionPreference = 'Stop'
$RunnerDirectory = (Resolve-Path -LiteralPath $RunnerDirectory).Path
if (!(Test-Path -LiteralPath (Join-Path $RunnerDirectory '.runner'))) { throw 'Register the local runner before starting it.' }
# Bound inherited CPU affinity and priority; the runner itself executes one job.
$process = [System.Diagnostics.Process]::GetCurrentProcess()
$process.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
$count = [Math]::Min(8, [Environment]::ProcessorCount)
$process.ProcessorAffinity = [IntPtr]([Math]::Pow(2, $count) - 1)
# Keep native executable paths below Windows CreateProcess limits. This alias
# points only at the isolated checkout; it does not move the live installation.
$workDirectory = (Resolve-Path -LiteralPath (Join-Path $RunnerDirectory '../self-hosted-work')).Path
$mapping = @(& subst.exe) | Where-Object { $_ -match '^R:' }
if ($mapping) {
    if ($mapping -notmatch [regex]::Escape($workDirectory)) { throw 'Drive R: belongs to another mapping.' }
} elseif (Test-Path R:\) { throw 'Drive R: is already in use.' }
else {
    & subst.exe R: $workDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Cannot map the isolated runner checkout to R:.' }
}
Set-Location -LiteralPath $RunnerDirectory
& ./run.cmd
exit $LASTEXITCODE
