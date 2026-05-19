param(
  [string]$PlantUmlJar = "",
  [switch]$SkipPng
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$pumlFiles = Get-ChildItem -File -Filter "*.puml" | Select-Object -ExpandProperty FullName
if (-not $pumlFiles -or $pumlFiles.Count -eq 0) {
  Write-Host "Nenhum ficheiro .puml encontrado em $scriptDir"
  exit 0
}

$plantumlCmd = Get-Command plantuml -ErrorAction SilentlyContinue

if ($plantumlCmd) {
  Write-Host "A usar comando 'plantuml' do sistema"
  & plantuml -tlatex:nopreamble $pumlFiles
  if (-not $SkipPng) {
    & plantuml -tpng $pumlFiles
  }
  Write-Host "Concluido: gerados ficheiros .latex" + ($(if (-not $SkipPng) {" e .png"} else {""}))
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PlantUmlJar)) {
  $PlantUmlJar = Join-Path $scriptDir "plantuml.jar"
}

if (-not (Test-Path $PlantUmlJar)) {
  throw "PlantUML não encontrado. Instala 'plantuml' no PATH ou indica -PlantUmlJar <caminho>."
}

Write-Host "A usar jar: $PlantUmlJar"
& java -jar $PlantUmlJar -tlatex:nopreamble $pumlFiles
if (-not $SkipPng) {
  & java -jar $PlantUmlJar -tpng $pumlFiles
}

Write-Host "Concluido: gerados ficheiros .latex" + ($(if (-not $SkipPng) {" e .png"} else {""}))
