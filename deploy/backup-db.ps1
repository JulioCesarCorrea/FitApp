<#
  Copia de seguridad de la base (SPEC-deploy-001, AC-deploy-001-09, P2).
  Hace un volcado con pg_dump dentro de un contenedor de Docker, así no hay que instalar PostgreSQL.

  Uso:
    $env:DATABASE_PUBLIC_URL = '<URL pública de la base en Railway>'   # es un secreto: no la guardes en el repositorio
    pwsh deploy/backup-db.ps1 -OutDir D:\copias-fitness

  Escribe fitness-AAAAMMDD-HHmmss.sql.gz en la carpeta de salida. No imprime la URL ni la clave.
  Para restaurar:  gunzip -c fitness-....sql.gz | psql "<url de destino>"
#>
[CmdletBinding()]
param(
  [string]$Url = $env:DATABASE_PUBLIC_URL,
  [string]$OutDir = (Join-Path (Get-Location) 'backups'),
  [string]$Image = 'postgres:17'
)

$ErrorActionPreference = 'Stop'

if (-not $Url) {
  throw 'Falta la URL de la base: define DATABASE_PUBLIC_URL (la URL pública de Postgres en Railway) o pásala con -Url.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'No encuentro Docker. Instala Docker Desktop y arráncalo.'
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$name = 'fitness-{0}.sql.gz' -f (Get-Date -Format 'yyyyMMdd-HHmmss')

# La URL viaja en una variable de entorno del contenedor, no en la línea de comandos.
$env:FITNESS_BACKUP_URL = $Url
try {
  $dump = 'pg_dump --no-owner --no-privileges "$FITNESS_BACKUP_URL" | gzip > /backup/' + $name
  docker run --rm -e FITNESS_BACKUP_URL -v "${OutDir}:/backup" $Image sh -c $dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump falló (código $LASTEXITCODE). Comprueba la URL y que Docker esté en marcha." }
}
finally {
  Remove-Item Env:FITNESS_BACKUP_URL -ErrorAction SilentlyContinue
}

$file = Join-Path $OutDir $name
if (-not (Test-Path $file) -or (Get-Item $file).Length -lt 100) {
  throw "El volcado salió vacío: $file"
}
Write-Host ("Copia creada: {0} ({1:N0} bytes)" -f $file, (Get-Item $file).Length)
