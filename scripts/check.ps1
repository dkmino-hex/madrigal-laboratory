$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    $packages = @('./...', './platform/...', './services/capture-service/...', './services/workspace-service/...')
    foreach ($check in @('test', 'vet', 'build')) {
        & go $check @packages
        if ($LASTEXITCODE -ne 0) { throw "go $check failed" }
    }
} finally {
    Pop-Location
}
