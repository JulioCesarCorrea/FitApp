<#
  Prepara la carpeta que se sube a Railway (SPEC-deploy-001, AC-deploy-001-08, ADR-0007):
  el código de la API, el Dockerfile y las imágenes del catálogo, que no están en el repositorio.

  Uso (desde la raíz del repositorio):
    pwsh deploy/prepare-upload.ps1
    pwsh deploy/prepare-upload.ps1 -ImagesPath C:\ruta\a\ejercicios

  Sin -ImagesPath toma Exercises:ImagesPath de src/Api/appsettings.Local.json.
  La salida queda en deploy/.stage (ignorada por git). Después: cd deploy/.stage; railway up
#>
[CmdletBinding()]
param(
  [string]$ImagesPath,
  [string]$OutDir
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot '.stage' }

if (-not $ImagesPath) {
  $local = Join-Path $root 'src/Api/appsettings.Local.json'
  if (Test-Path $local) {
    $ImagesPath = (Get-Content $local -Raw -Encoding UTF8 | ConvertFrom-Json).Exercises.ImagesPath
  }
}
if (-not $ImagesPath -or -not (Test-Path $ImagesPath)) {
  throw "No encuentro la carpeta de imágenes del catálogo. Pásala con -ImagesPath o ponla en Exercises:ImagesPath de src/Api/appsettings.Local.json."
}
$images = @(Get-ChildItem $ImagesPath -File | Where-Object { $_.Extension -in '.jpg', '.jpeg', '.png' })
if ($images.Count -eq 0) {
  throw "La carpeta '$ImagesPath' no tiene imágenes .jpg ni .png."
}

# Se conserva la carpeta .railway (el enlace con el proyecto) si ya existía; todo lo demás se rehace.
$keep = Join-Path $OutDir '.railway'
$saved = $null
if (Test-Path $keep) {
  $saved = Join-Path ([IO.Path]::GetTempPath()) ("railway-link-" + [guid]::NewGuid().ToString('N'))
  Move-Item $keep $saved
}
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir | Out-Null
if ($saved) { Move-Item $saved $keep }

# Código de la API sin compilados ni ajustes locales.
$null = robocopy (Join-Path $root 'src/Api') (Join-Path $OutDir 'src/Api') /E /XD bin obj /XF appsettings.Local.json appsettings.Local.json.example /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy falló con el código $LASTEXITCODE." }
$global:LASTEXITCODE = 0

Copy-Item (Join-Path $PSScriptRoot 'Dockerfile') (Join-Path $OutDir 'Dockerfile')
$target = Join-Path $OutDir 'images'
New-Item -ItemType Directory -Path $target | Out-Null
$images | Copy-Item -Destination $target

Write-Host "Carpeta lista: $OutDir"
Write-Host "  Imágenes: $($images.Count)"
Write-Host "  Siguiente paso: cd '$OutDir'; railway up"
