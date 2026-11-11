# Compara o consumo do OpenCord Electron com o protótipo em Tauri (rodar no Windows, PowerShell):
#   powershell -ExecutionPolicy Bypass -File compare.ps1 [-Seconds 60]
# Para cada app aberto, soma a árvore de processos inteira (no Tauri, inclui os processos do WebView2) e mede a média
# de CPU no período. Deixe os dois na MESMA situação (mesma tela, mesma chamada/live) para a comparação valer.
param([int]$Seconds = 30)

$all = Get-CimInstance Win32_Process
$byParent = $all | Group-Object ParentProcessId -AsHashTable -AsString
function Tree($procId) {
  $out = @($procId); $i = 0
  while ($i -lt $out.Count) {
    $kids = $byParent["$($out[$i])"]
    if ($kids) { $out += $kids | ForEach-Object { $_.ProcessId } }
    $i++
  }
  $out
}
$roots = $all | Where-Object {
  ($_.Name -eq 'OpenCord.exe' -or $_.Name -eq 'opencord-tauri.exe') -and
  -not ($all | Where-Object { $_.ProcessId -eq $_.ParentProcessId -and $false }) -and
  -not (($all | Where-Object ProcessId -eq $_.ParentProcessId).Name -in @('OpenCord.exe', 'opencord-tauri.exe'))
}
if (-not $roots) { Write-Host 'Nenhum OpenCord aberto.'; exit 1 }

$apps = foreach ($r in $roots) {
  $label = if ($r.Name -eq 'opencord-tauri.exe') { 'Tauri' } else { 'Electron' }
  if ($r.CommandLine -match '--user-data-dir') { $label += ' (perfil de teste)' }
  [pscustomobject]@{ Label = $label; Pid = $r.ProcessId; Pids = Tree $r.ProcessId }
}
$cpu0 = @{}; foreach ($a in $apps) { $cpu0[$a.Pid] = (Get-Process -Id $a.Pids -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum }
Write-Host "Medindo por $Seconds s..."
$ws = @{}; $priv = @{}; foreach ($a in $apps) { $ws[$a.Pid] = 0; $priv[$a.Pid] = 0 }
for ($s = 0; $s -lt $Seconds; $s++) {
  foreach ($a in $apps) {
    $p = Get-Process -Id $a.Pids -ErrorAction SilentlyContinue
    $ws[$a.Pid] += ($p | Measure-Object WorkingSet64 -Sum).Sum
    $priv[$a.Pid] += ($p | Measure-Object PrivateMemorySize64 -Sum).Sum
  }
  Start-Sleep 1
}
$cores = [Environment]::ProcessorCount
$apps | ForEach-Object {
  $cpu1 = (Get-Process -Id $_.Pids -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum
  [pscustomobject]@{
    App = $_.Label
    Processos = $_.Pids.Count
    'Memória em uso (MB)' = [math]::Round($ws[$_.Pid] / $Seconds / 1MB)
    'Memória privada (MB)' = [math]::Round($priv[$_.Pid] / $Seconds / 1MB)
    'CPU média (% do PC)' = [math]::Round(100 * ($cpu1 - $cpu0[$_.Pid]) / $Seconds / $cores, 2)
  }
} | Format-Table -AutoSize
