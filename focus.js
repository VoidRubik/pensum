// Foreground-window tracker: one persistent PowerShell child prints {process,title,hwnd} when the foreground
// changes, and {work:{alive,visible}} when the chosen work window (QL_WORK) is closed/minimized/restored.
// Events live in a ring buffer in memory only — window titles never touch disk.
const { spawn } = require('node:child_process');
const { focusSummary } = require('./logic.js');

const PS = `
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public class FG{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
[DllImport("user32.dll")]public static extern bool IsWindow(IntPtr h);
[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);}
'@
$last='';$lastW='';$wp='';$w=[IntPtr][int64]$env:QL_WORK
while($true){
  if(-not (Get-Process -Id $env:QL_PARENT -ErrorAction SilentlyContinue)){exit}
  $h=[FG]::GetForegroundWindow()
  if($h -ne [IntPtr]::Zero){
    $sb=New-Object Text.StringBuilder 256;[void][FG]::GetWindowText($h,$sb,256)
    $p=0;[void][FG]::GetWindowThreadProcessId($h,[ref]$p)
    $n=(Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
    $o=@{process=$n;title=$sb.ToString();hwnd=$h.ToInt64()}|ConvertTo-Json -Compress
    if($o -ne $last){[Console]::Out.WriteLine($o);[Console]::Out.Flush();$last=$o}
  }
  if($w -ne [IntPtr]::Zero){
    $al=[FG]::IsWindow($w)
    if($al -and -not $wp){$wpid=0;[void][FG]::GetWindowThreadProcessId($w,[ref]$wpid);$wp=(Get-Process -Id $wpid -ErrorAction SilentlyContinue).ProcessName}
    $o=@{work=@{alive=$al;visible=((-not [FG]::IsIconic($w)) -and [FG]::IsWindowVisible($w));proc=$wp}}|ConvertTo-Json -Compress
    if($o -ne $lastW){[Console]::Out.WriteLine($o);[Console]::Out.Flush();$lastW=$o}
  }
  Start-Sleep -Seconds 1
}`;

const MAX_EVENTS = 200;
const MAX_RESPAWNS = 3;
let child = null;
let events = [];
let respawns = 0;
let running = false;
let respawnTimer = null;
let onEvent = () => {};
let onWorkState = () => {};
let workHwnd = 0;

function spawnChild() {
  const enc = Buffer.from(PS, 'utf16le').toString('base64');
  const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
    { windowsHide: true, env: { ...process.env, QL_PARENT: String(process.pid), QL_WORK: String(workHwnd) } });
  child = c;
  let buf = '';
  c.stdout.setEncoding('utf8');
  c.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      try {
        const e = JSON.parse(line);
        if (e.work) { onWorkState({ alive: !!e.work.alive, visible: !!e.work.visible, proc: e.work.proc || null }); continue; }
        if (e.process && e.title !== 'Questling') {
          events.push({ ts: Date.now(), process: e.process, title: e.title || '', hwnd: e.hwnd || 0 });
          if (events.length > MAX_EVENTS) events.shift();
          onEvent(events[events.length - 1]);
        }
      } catch {}
    }
  });
  // Compare handles: a stale child's exit must not null the new child (that would orphan it).
  c.on('exit', () => {
    if (child !== c) return;
    child = null;
    if (running && respawns < MAX_RESPAWNS) { respawns++; respawnTimer = setTimeout(() => running && !child && spawnChild(), 1000); }
  });
  c.on('error', () => { if (child === c) child = null; });
}

function start(cb, cbWork) {
  if (running) return;
  running = true;
  respawns = 0;
  if (cb) onEvent = cb;
  if (cbWork) onWorkState = cbWork;
  spawnChild();
}

/** Tell the tracker which window is the work window. Respawns the child (the id travels in its env). */
function setWork(hwnd) {
  workHwnd = Number(hwnd) || 0;
  if (!running) return;
  respawns = 0;
  if (child) { const old = child; child = null; old.kill(); }
  spawnChild();
}

function stop() {
  running = false;
  clearTimeout(respawnTimer);
  events = []; // screen-derived: drop on pause
  workHwnd = 0;
  if (child) { child.kill(); child = null; }
}

const current = () => events[events.length - 1] || null;
const summary = (since, now, opts) => focusSummary(events, since, now, opts);

module.exports = { start, stop, setWork, current, summary };
