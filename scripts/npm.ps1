$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $projectRoot '.toolchain\node_modules\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $runtime)) {
    throw 'Install Node 24.22.0 into .toolchain or use a system Node 24.22.0 with npm directly.'
}
$npmDirectory = Split-Path -Parent (Get-Command npm.ps1).Source
$npmCli = Join-Path $npmDirectory 'node_modules\npm\bin\npm-cli.js'
$env:PATH = "$(Split-Path -Parent $runtime);$env:PATH"

Push-Location $projectRoot
try {
    & $runtime $npmCli @args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
