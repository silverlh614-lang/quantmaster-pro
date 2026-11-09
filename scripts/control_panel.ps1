<#
  @responsibility QuantMaster Pro 로컬 서버 제어판 — 상태 표시와 켜기·끄기·재시작을 제공하는 Windows 창.
  실행: 바탕화면 'QuantMaster Pro 제어판' 바로 가기 (더블클릭)
  바로 가기 다시 만들기: powershell -ExecutionPolicy Bypass -File scripts\control_panel.ps1 -InstallShortcut
  - 켜기: 작업 스케줄러 'QuantMasterPro' 실행 (컴퓨터 시작 시 자동 실행과 같은 경로)
  - 끄기: scripts\stop_local.mjs 정상 종료 (강제 종료하지 않는다 — 기억 파일 보호)
  - 이 창을 닫아도 서버는 계속 실행된다.
  - 운영 폴더(qmp-runtime)의 사본으로 연다. '자동 배포' 줄은 <로그폴더>\deploy-state.json(local_runtime.mjs 기록)을 보여 준다.
  - 서버 상태와 무관하게 동작해야 하므로 서버(3000) 밖의 독립 창으로 둔다. 로컬 HTTP 제어 엔드포인트는 만들지 않는다(CSRF 위험).
#>
param(
  [switch]$InstallShortcut,
  [string]$SnapshotPath  # 개발 검증용: 창을 띄우지 않고 화면을 PNG 로 저장한다
)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$TaskName = 'QuantMasterPro'
$AppDir = Join-Path $env:LOCALAPPDATA 'QuantMasterPro'
$IconPath = Join-Path $AppDir 'qmp.ico'

function Get-DotEnv {
  $map = @{}
  $file = Join-Path $Repo '.env'
  if (Test-Path -LiteralPath $file) {
    foreach ($line in [IO.File]::ReadAllLines($file, [Text.Encoding]::UTF8)) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $v = $Matches[2].Trim()
        if ($v.Length -ge 2 -and $v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
        $map[$Matches[1]] = $v
      }
    }
  }
  $map
}

function Resolve-RepoPath([string]$value, [string]$fallback) {
  if (-not $value) { $value = $fallback }
  [IO.Path]::GetFullPath([IO.Path]::Combine($Repo, $value.Replace('/', '\')))
}

$EnvMap = Get-DotEnv
$Port = 3000
if ($EnvMap['PORT']) { $Port = [int]$EnvMap['PORT'] }
$LogDir = Resolve-RepoPath $EnvMap['LOCAL_LOG_DIR'] 'logs'
$DataDir = if ($EnvMap['PERSIST_DATA_DIR']) { Resolve-RepoPath $EnvMap['PERSIST_DATA_DIR'] 'data' } else { '(PERSIST_DATA_DIR 미설정)' }
$DeployStateFile = Join-Path $LogDir 'deploy-state.json'
$NodeExe = 'C:\Program Files\nodejs\node.exe'
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCmd) { $NodeExe = $nodeCmd.Source }

Add-Type -AssemblyName System.Drawing

# ─── 아이콘 (상승 차트) ─────────────────────────────────────────────────────
function New-QmpBitmap([int]$size) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = [single]($size * 0.44)
  $w = [single]($size - 1)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc(0, 0, $r, $r, 180, 90)
  $path.AddArc($w - $r, 0, $r, $r, 270, 90)
  $path.AddArc($w - $r, $w - $r, $r, $r, 0, 90)
  $path.AddArc(0, $w - $r, $r, $r, 90, 90)
  $path.CloseFigure()
  $bg = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 15, 23, 42))
  $g.FillPath($bg, $path)
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 34, 197, 94), [single]([Math]::Max(1.5, $size * 0.09)))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pts = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($size * 0.20, $size * 0.70),
    [System.Drawing.PointF]::new($size * 0.40, $size * 0.50),
    [System.Drawing.PointF]::new($size * 0.56, $size * 0.62),
    [System.Drawing.PointF]::new($size * 0.80, $size * 0.32)
  )
  $g.DrawLines($pen, $pts)
  $d = [single]($size * 0.17)
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $g.FillEllipse($white, [single]($size * 0.80 - $d / 2), [single]($size * 0.32 - $d / 2), $d, $d)
  $pen.Dispose(); $bg.Dispose(); $white.Dispose(); $path.Dispose(); $g.Dispose()
  $bmp
}

function Save-QmpIcon([string]$path) {
  $sizes = @(256, 48, 32, 16)
  $images = New-Object System.Collections.Generic.List[byte[]]
  foreach ($s in $sizes) {
    $bmp = New-QmpBitmap $s
    $ms = [IO.MemoryStream]::new()
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $images.Add($ms.ToArray())
    $bmp.Dispose(); $ms.Dispose()
  }
  # ICO 컨테이너(PNG 프레임) — Windows Vista 이상 탐색기·바로 가기에서 지원
  $fs = [IO.File]::Create($path)
  $bw = [IO.BinaryWriter]::new($fs)
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$images[$i].Length); $bw.Write([UInt32]$offset)
    $offset += $images[$i].Length
  }
  foreach ($img in $images) { $bw.Write($img) }
  $bw.Close()
}

function Install-QmpShortcut {
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  Save-QmpIcon $IconPath
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'QuantMaster Pro 제어판.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  $s.WorkingDirectory = $Repo
  $s.IconLocation = "$IconPath,0"
  $s.Description = 'QuantMaster Pro 로컬 서버 상태 확인과 켜기/끄기'
  $s.WindowStyle = 7
  $s.Save()
  $lnk
}

if ($InstallShortcut) {
  $created = Install-QmpShortcut
  "SHORTCUT_OK $created"
  return
}

# ─── 창 ────────────────────────────────────────────────────────────────────
Add-Type -AssemblyName System.Windows.Forms, System.Net.Http
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class QmpNative { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][QmpNative]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\QuantMasterProControlPanel', [ref]$createdNew)
if (-not $createdNew -and -not $SnapshotPath) {
  [void][System.Windows.Forms.MessageBox]::Show('제어판이 이미 열려 있습니다. 작업 표시줄을 확인하세요.', 'QuantMaster Pro')
  return
}

$Color = @{
  Header = [System.Drawing.Color]::FromArgb(248, 250, 252)
  Card   = [System.Drawing.Color]::White
  Text   = [System.Drawing.Color]::FromArgb(15, 23, 42)
  Muted  = [System.Drawing.Color]::FromArgb(100, 116, 139)
  Border = [System.Drawing.Color]::FromArgb(226, 232, 240)
  Green  = [System.Drawing.Color]::FromArgb(22, 163, 74)
  Red    = [System.Drawing.Color]::FromArgb(220, 38, 38)
  Amber  = [System.Drawing.Color]::FromArgb(217, 119, 6)
  Slate  = [System.Drawing.Color]::FromArgb(51, 65, 85)
  Off    = [System.Drawing.Color]::FromArgb(203, 213, 225)
  LogBg  = [System.Drawing.Color]::FromArgb(15, 23, 42)
  LogFg  = [System.Drawing.Color]::FromArgb(226, 232, 240)
}
$FontName = 'Malgun Gothic'
$FontTitle = [System.Drawing.Font]::new($FontName, 17, [System.Drawing.FontStyle]::Bold)
$FontBody  = [System.Drawing.Font]::new($FontName, 10)
$FontBold  = [System.Drawing.Font]::new($FontName, 10, [System.Drawing.FontStyle]::Bold)
$FontBtn   = [System.Drawing.Font]::new($FontName, 11, [System.Drawing.FontStyle]::Bold)
$FontSmall = [System.Drawing.Font]::new($FontName, 9)
$FontLog   = [System.Drawing.Font]::new('Consolas', 8.5)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'QuantMaster Pro 제어판'
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false
$form.BackColor = $Color.Card
$form.Font = $FontBody
$form.AutoScaleDimensions = [System.Drawing.SizeF]::new(96, 96)
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$form.ClientSize = [System.Drawing.Size]::new(520, 720)
try { $form.Icon = [System.Drawing.Icon]::FromHandle((New-QmpBitmap 64).GetHicon()) } catch { Write-Verbose "icon: $($_.Exception.Message)" }

function Add-Label($parent, [string]$text, [int]$x, [int]$y, [int]$w, [int]$h, $font, $color) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text
  $l.Location = [System.Drawing.Point]::new($x, $y)
  $l.Size = [System.Drawing.Size]::new($w, $h)
  $l.Font = $font
  $l.ForeColor = $color
  $l.AutoEllipsis = $true
  $parent.Controls.Add($l)
  $l
}

function Add-Button([string]$text, [int]$x, [int]$y, [int]$w, [int]$h, $back, $fore, $font) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text
  $b.Location = [System.Drawing.Point]::new($x, $y)
  $b.Size = [System.Drawing.Size]::new($w, $h)
  $b.Font = $font
  $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $b.UseVisualStyleBackColor = $false
  $b.BackColor = $back
  $b.ForeColor = $fore
  $b.FlatAppearance.BorderColor = $Color.Border
  $b.FlatAppearance.BorderSize = if ($back -eq $Color.Card) { 1 } else { 0 }
  $b.Cursor = [System.Windows.Forms.Cursors]::Hand
  $b.Tag = $back
  $form.Controls.Add($b)
  $b
}

function Set-ButtonEnabled($button, [bool]$enabled) {
  if ($button.Enabled -eq $enabled) { return }
  $button.Enabled = $enabled
  if ($button.Tag -ne $Color.Card) { $button.BackColor = if ($enabled) { $button.Tag } else { $Color.Off } }
}

# 상단 상태 영역
$header = New-Object System.Windows.Forms.Panel
$header.Location = [System.Drawing.Point]::new(0, 0)
$header.Size = [System.Drawing.Size]::new(520, 96)
$header.BackColor = $Color.Header
$form.Controls.Add($header)

$script:dotColor = $Color.Off
$dot = New-Object System.Windows.Forms.Panel
$dot.Location = [System.Drawing.Point]::new(24, 33)
$dot.Size = [System.Drawing.Size]::new(26, 26)
$dot.BackColor = $Color.Header
$dot.add_Paint({
  param($ctl, $paintArgs)
  $paintArgs.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $brush = [System.Drawing.SolidBrush]::new($script:dotColor)
  $paintArgs.Graphics.FillEllipse($brush, 1, 1, $ctl.Width - 3, $ctl.Height - 3)
  $brush.Dispose()
})
$header.Controls.Add($dot)
$lblStatus = Add-Label $header '확인 중…' 62 18 440 40 $FontTitle $Color.Text
$lblSub = Add-Label $header '' 64 60 440 24 $FontSmall $Color.Muted

$sep = New-Object System.Windows.Forms.Label
$sep.Location = [System.Drawing.Point]::new(0, 96); $sep.Size = [System.Drawing.Size]::new(520, 1); $sep.BackColor = $Color.Border
$form.Controls.Add($sep)

# 정보 행
$rows = [ordered]@{ uptime = '가동 시간'; commit = '실행 커밋'; deploy = '자동 배포'; mode = '운영 모드'; memory = '기억 진단'; data = '데이터 폴더' }
$infoValue = @{}
$y = 114
foreach ($key in $rows.Keys) {
  [void](Add-Label $form $rows[$key] 24 $y 110 26 $FontBody $Color.Muted)
  $infoValue[$key] = Add-Label $form '—' 140 $y 356 26 $FontBold $Color.Text
  $y += 30
}
$infoValue['data'].Text = $DataDir
$infoValue['data'].Font = $FontSmall

# 버튼
$btnOn      = Add-Button '켜기'   24 310 148 48 $Color.Green $Color.Card $FontBtn
$btnOff     = Add-Button '끄기'   186 310 148 48 $Color.Red $Color.Card $FontBtn
$btnRestart = Add-Button '재시작' 348 310 148 48 $Color.Slate $Color.Card $FontBtn
$btnWeb  = Add-Button '웹 화면 열기' 24 370 148 36 $Color.Card $Color.Text $FontBody
$btnLogs = Add-Button '로그 폴더'    186 370 148 36 $Color.Card $Color.Text $FontBody
$btnData = Add-Button '데이터 폴더'  348 370 148 36 $Color.Card $Color.Text $FontBody

[void](Add-Label $form '최근 로그' 24 424 200 24 $FontBold $Color.Text)
$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = [System.Drawing.Point]::new(24, 450)
$logBox.Size = [System.Drawing.Size]::new(472, 214)
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.WordWrap = $false
$logBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Both
$logBox.BackColor = $Color.LogBg
$logBox.ForeColor = $Color.LogFg
$logBox.Font = $FontLog
$logBox.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$form.Controls.Add($logBox)

[void](Add-Label $form '이 창을 닫아도 서버는 계속 실행됩니다. 컴퓨터를 켜면 1분 뒤 자동으로 시작되고, GitHub main 에 push 하면 1분 안에 자동 반영됩니다.' 24 674 472 36 $FontSmall $Color.Muted)

# ─── 상태 확인 ───────────────────────────────────────────────────────────────
$script:http = [System.Net.Http.HttpClient]::new()
$script:http.Timeout = [TimeSpan]::FromSeconds(5)
$script:scheduler = $null
$script:healthReq = $null; $script:auditReq = $null
$script:health = $null; $script:healthAt = [DateTime]::MinValue
$script:audit = $null; $script:auditAt = [DateTime]::MinValue
$script:pending = $null; $script:pendingAt = [DateTime]::MinValue
$script:stopProc = $null
$script:lastLogText = $null
$script:listenSince = $null
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500

function Show-Warn([string]$message) {
  $timer.Stop()
  try {
    [void][System.Windows.Forms.MessageBox]::Show($form, $message, 'QuantMaster Pro',
      [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
  } finally { $timer.Start() }
}

function Confirm-Action([string]$message, [string]$title) {
  $timer.Stop()
  try {
    $answer = [System.Windows.Forms.MessageBox]::Show($form, $message, $title,
      [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning,
      [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
    $answer -eq [System.Windows.Forms.DialogResult]::Yes
  } finally { $timer.Start() }
}

function Get-QmpTask {
  if (-not $script:scheduler) {
    $script:scheduler = New-Object -ComObject Schedule.Service
    $script:scheduler.Connect()
  }
  try { $script:scheduler.GetFolder('\').GetTask($TaskName) } catch { $null }
}

function Test-Listening {
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  @($listeners | Where-Object { $_.Port -eq $Port }).Count -gt 0
}

# 비동기 요청: 이번 틱에 시작하고 다음 틱에 결과를 읽는다(창이 멈추지 않게).
function Receive-Json([ref]$request, [string]$url) {
  if ($null -eq $request.Value) { $request.Value = $script:http.GetStringAsync($url); return $null }
  if (-not $request.Value.IsCompleted) { return $null }
  $task = $request.Value
  $request.Value = $null
  if ($task.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) {
    return @{ ok = $true; data = ($task.Result | ConvertFrom-Json) }
  }
  [void]$task.Exception  # 실패 관찰 처리(미관찰 예외 방지)
  @{ ok = $false }
}

function Format-Uptime([double]$seconds) {
  $ts = [TimeSpan]::FromSeconds($seconds)
  if ($ts.TotalDays -ge 1) { return '{0}일 {1}시간 {2}분' -f [int][Math]::Floor($ts.TotalDays), $ts.Hours, $ts.Minutes }
  if ($ts.TotalHours -ge 1) { return '{0}시간 {1}분' -f $ts.Hours, $ts.Minutes }
  '{0}분 {1}초' -f $ts.Minutes, $ts.Seconds
}

function Read-LogTail {
  if (-not (Test-Path -LiteralPath $LogDir)) { return '(로그 폴더 없음)' }
  $today = [DateTime]::UtcNow.AddHours(9).ToString('yyyy-MM-dd')
  $file = Join-Path $LogDir "qmp-$today.log"
  if (-not (Test-Path -LiteralPath $file)) {
    $latest = Get-ChildItem -LiteralPath $LogDir -Filter 'qmp-*.log' | Sort-Object Name | Select-Object -Last 1
    if (-not $latest) { return '(아직 로그가 없습니다)' }
    $file = $latest.FullName
  }
  $fs = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $start = [Math]::Max([long]0, $fs.Length - 32768)
    [void]$fs.Seek($start, [IO.SeekOrigin]::Begin)
    $buf = New-Object byte[] ([int]($fs.Length - $start))
    $read = $fs.Read($buf, 0, $buf.Length)
  } finally { $fs.Dispose() }
  $text = [regex]::Replace([Text.Encoding]::UTF8.GetString($buf, 0, $read), '\x1b\[[0-9;]*[A-Za-z]', '')
  $lines = @($text -split "`r?`n" | Where-Object { $_.Trim() })
  if ($start -gt 0 -and $lines.Count -gt 1) { $lines = $lines[1..($lines.Count - 1)] }  # 잘린 첫 줄 제외
  $lines = @($lines | Select-Object -Last 40 | ForEach-Object { if ($_.Length -gt 260) { $_.Substring(0, 260) + '…' } else { $_ } })
  $lines -join "`r`n"
}

$PhaseText = @{
  'stopping' = '서버 종료'; 'updating' = '코드 교체'; 'installing' = '패키지 설치'; 'building' = '화면 빌드'
  'restarting-runtime' = '실행기 재시작'; 'verifying' = '기동 확인'; 'rolling-back' = '이전 버전 복귀'
}

function Get-Short([string]$sha) { if ($sha.Length -gt 7) { $sha.Substring(0, 7) } else { $sha } }

function Read-DeployState {
  if (-not (Test-Path -LiteralPath $DeployStateFile)) { return $null }
  try { [IO.File]::ReadAllText($DeployStateFile, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { $null }
}

# 진행 중인 배포 단계. 실행기가 도중에 꺼져 오래 남은 기록(40분 초과)은 무시한다.
function Get-ActiveDeployPhase($state) {
  if (-not $state -or -not $state.phase) { return $null }
  try { $at = [DateTime]::Parse([string]$state.phaseAt).ToUniversalTime() } catch { return $null }
  if (([DateTime]::UtcNow - $at).TotalMinutes -gt 40) { return $null }
  [string]$state.phase
}

function Format-DeployInfo($state) {
  if (-not $state) { return @('정보 없음', $Color.Muted) }
  $phase = Get-ActiveDeployPhase $state
  if ($phase) { return @("배포 중 · $($PhaseText[$phase]) $(Get-Short ([string]$state.phaseTarget))", $Color.Amber) }
  $mode = if ($state.autoDeploy) { '켜짐' } else { '꺼짐' }
  $last = $state.last
  if (-not $last) { return @("$mode · 아직 배포 기록 없음", $Color.Text) }
  $when = ''
  try { $when = [DateTime]::Parse([string]$last.at).ToLocalTime().ToString('MM.dd HH:mm') } catch { $when = '' }
  $sha = Get-Short ([string]$last.target)
  switch ([string]$last.result) {
    'deployed'    { return @("$mode · $when $sha 반영", $Color.Text) }
    'rolled-back' { return @("$mode · $when $sha 실패 → 이전 버전 복귀", $Color.Amber) }
    default       { return @("$mode · $when $sha 실패 · 로그 확인", $Color.Red) }
  }
}

function Set-Status([string]$tone, [string]$text) {
  $script:dotColor = switch ($tone) { 'green' { $Color.Green } 'red' { $Color.Red } 'amber' { $Color.Amber } default { $Color.Off } }
  $dot.Invalidate()
  if ($lblStatus.Text -ne $text) { $lblStatus.Text = $text }
}

function Invoke-Stop([string]$mode) {
  try {
    $script:stopProc = Start-Process -FilePath $NodeExe -ArgumentList 'scripts\stop_local.mjs' -WorkingDirectory $Repo -WindowStyle Hidden -PassThru
    [void]$script:stopProc.Handle  # 핸들을 잡아 두어야 종료 후 ExitCode 를 읽을 수 있다
    $script:pending = $mode
    $script:pendingAt = Get-Date
    Update-Status
  } catch { Show-Warn "끄기 요청 실패: $($_.Exception.Message)" }
}

function Start-QmpServer {
  $task = Get-QmpTask
  if (-not $task) { throw "작업 스케줄러에 '$TaskName' 작업이 없습니다." }
  [void]$task.Run($null)
  $script:pending = 'start'
  $script:pendingAt = Get-Date
}

function Update-Status {
  $now = Get-Date
  $listening = Test-Listening
  $task = Get-QmpTask
  $taskState = if ($task) { [int]$task.State } else { -1 }  # 1 사용 안 함, 3 대기, 4 실행 중

  if ($listening) {
    if ($null -eq $script:listenSince) { $script:listenSince = $now }
    $h = Receive-Json ([ref]$script:healthReq) "http://127.0.0.1:$Port/api/health"
    if ($h -and $h.ok) { $script:health = $h.data; $script:healthAt = $now }
    if ($null -ne $script:auditReq -or ($now - $script:auditAt).TotalSeconds -ge 30) {
      $a = Receive-Json ([ref]$script:auditReq) "http://127.0.0.1:$Port/api/diagnostic/memory-audit"
      if ($a) { $script:auditAt = $now; if ($a.ok) { $script:audit = $a.data } }
    }
  } else {
    $script:listenSince = $null
    $script:health = $null; $script:healthReq = $null
    $script:audit = $null; $script:auditReq = $null; $script:auditAt = [DateTime]::MinValue
  }
  $healthy = $listening -and $null -ne $script:health -and ($now - $script:healthAt).TotalSeconds -lt 15
  $deployState = Read-DeployState
  $deployPhase = Get-ActiveDeployPhase $deployState
  $stopFailed = $script:stopProc -and $script:stopProc.HasExited -and $script:stopProc.ExitCode -ne 0 -and $listening

  switch ($script:pending) {
    'stop' {
      if (-not $listening -and $taskState -ne 4) { $script:pending = $null }
      elseif ($stopFailed) { $script:pending = $null; Show-Warn '정상 종료가 확인되지 않았습니다. 잠시 뒤 다시 시도하거나 최근 로그를 확인하세요.' }
    }
    'restart-stop' {
      if (-not $listening -and $taskState -ne 4) {
        try { Start-QmpServer } catch { $script:pending = $null; Show-Warn "다시 켜기 실패: $($_.Exception.Message)" }
      } elseif ($stopFailed) { $script:pending = $null; Show-Warn '정상 종료가 확인되지 않아 재시작을 멈췄습니다. 최근 로그를 확인하세요.' }
    }
    'start' {
      if ($healthy) { $script:pending = $null }
      elseif (($now - $script:pendingAt).TotalSeconds -gt 300) { $script:pending = $null; Show-Warn '5분 안에 응답하지 않았습니다. 최근 로그를 확인하세요.' }
    }
  }

  if ($script:pending -in @('stop', 'restart-stop')) { Set-Status 'amber' '끄는 중…' }
  elseif ($script:pending -eq 'start') { Set-Status 'amber' $(if ($listening) { '켜는 중… (기동 작업 처리)' } else { '켜는 중…' }) }
  elseif ($deployPhase -and -not $healthy) { Set-Status 'amber' "배포 중… ($($PhaseText[$deployPhase]))" }
  elseif ($healthy) { Set-Status 'green' '실행 중' }
  elseif ($listening -and ($now - $script:listenSince).TotalSeconds -lt 20) { Set-Status 'gray' '확인 중…' }
  elseif ($listening) { Set-Status 'amber' '응답 지연 — 작업 처리 중' }
  elseif ($taskState -eq 4) { Set-Status 'amber' '켜는 중… (자동 재기동)' }
  else { Set-Status 'red' '꺼짐' }

  $taskText = switch ($taskState) { 4 { '실행 중' } 3 { '대기' } 1 { '사용 안 함' } -1 { '없음' } default { "상태 $taskState" } }
  $lblSub.Text = "마지막 확인 $($now.ToString('HH:mm:ss')) · 자동 시작 작업: $taskText"

  if ($healthy) {
    $infoValue['uptime'].Text = Format-Uptime ([double]$script:health.uptime)
    $infoValue['commit'].Text = [string]$script:health.commit
    $mode = ([string]$script:health.mode).ToUpper()
    $modeText = switch ($mode) { 'SHADOW' { 'SHADOW · 가상 판단·학습' } 'LIVE' { 'LIVE · 실주문' } default { $mode } }
    if ($script:health.emergencyStop) { $modeText += ' · 비상 정지 중' }
    $infoValue['mode'].Text = $modeText
    $infoValue['mode'].ForeColor = if ($script:health.emergencyStop -or $mode -eq 'LIVE') { $Color.Red } else { $Color.Text }
  } elseif (-not $listening) {
    foreach ($k in 'uptime', 'commit', 'mode') { $infoValue[$k].Text = '—'; $infoValue[$k].ForeColor = $Color.Text }
  }
  $deployInfo = Format-DeployInfo $deployState
  if ($infoValue['deploy'].Text -ne $deployInfo[0]) { $infoValue['deploy'].Text = $deployInfo[0] }
  $infoValue['deploy'].ForeColor = $deployInfo[1]
  if ($script:audit) {
    $infoValue['memory'].Text = "$($script:audit.verdict) · $($script:audit.healthScore)점"
    $infoValue['memory'].ForeColor = if ($script:audit.verdict -eq 'HEALTHY') { $Color.Green } else { $Color.Amber }
  } elseif (-not $listening) { $infoValue['memory'].Text = '—'; $infoValue['memory'].ForeColor = $Color.Text }

  $busy = $null -ne $script:pending
  Set-ButtonEnabled $btnOn (-not $busy -and -not $listening -and $taskState -ne 4)
  Set-ButtonEnabled $btnOff (-not $busy -and ($listening -or $taskState -eq 4))
  Set-ButtonEnabled $btnRestart (-not $busy -and $listening)
  $btnWeb.Enabled = $listening

  $logText = Read-LogTail
  if ($logText -ne $script:lastLogText) {
    $logBox.Text = $logText
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
    $script:lastLogText = $logText
  }
}

$btnOn.add_Click({ try { Start-QmpServer; Update-Status } catch { Show-Warn "켜기 실패: $($_.Exception.Message)" } })
$btnOff.add_Click({
  $msg = "서버를 끄면 Shadow 관측·학습, 텔레그램 명령 응답, 08:30 추천 발송이 모두 멈춥니다.`n`n서버를 끄시겠습니까?"
  if (Confirm-Action $msg '서버 끄기') { Invoke-Stop 'stop' }
})
$btnRestart.add_Click({
  if (Confirm-Action "서버를 정상 종료한 뒤 다시 켭니다(약 1분).`n`n재시작하시겠습니까?" '서버 재시작') { Invoke-Stop 'restart-stop' }
})
$btnWeb.add_Click({ Start-Process "http://localhost:$Port" })
$btnLogs.add_Click({ if (Test-Path -LiteralPath $LogDir) { Start-Process explorer.exe -ArgumentList "`"$LogDir`"" } })
$btnData.add_Click({ if (Test-Path -LiteralPath $DataDir) { Start-Process explorer.exe -ArgumentList "`"$DataDir`"" } })
$timer.add_Tick({ try { Update-Status } catch { $lblSub.Text = "상태 확인 오류: $($_.Exception.Message)" } })
$form.add_Shown({ Update-Status; $timer.Start() })
$form.add_FormClosed({ $timer.Stop(); $script:http.Dispose(); if ($createdNew) { $mutex.ReleaseMutex() } })

if ($SnapshotPath) {
  # 개발 검증용: 화면 밖에 실제로 띄워 몇 차례 갱신(비동기 응답 수신)한 뒤 창을 PNG 로 저장한다.
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.Location = [System.Drawing.Point]::new(-4000, -4000)
  $form.ShowInTaskbar = $false
  $form.Show()
  $deadline = (Get-Date).AddSeconds(6)
  while ((Get-Date) -lt $deadline) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
  Update-Status
  [System.Windows.Forms.Application]::DoEvents()
  $shot = [System.Drawing.Bitmap]::new($form.Width, $form.Height)
  $form.DrawToBitmap($shot, [System.Drawing.Rectangle]::new(0, 0, $form.Width, $form.Height))
  $shot.Save($SnapshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $form.Close()
  "SNAPSHOT_OK $SnapshotPath"
  return
}

[System.Windows.Forms.Application]::Run($form)
