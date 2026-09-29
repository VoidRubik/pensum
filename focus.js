// Foreground-window tracker: one persistent PowerShell child prints {process,title} on change.
// Events live in a ring buffer in memory only — window titles never touch disk.
const { spawn } = require('node:child_process');
const { focusSummary } = require('./logic.js');

const PS = `
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public class FG{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}
'@
$last=''
while($true){
  if(-not (Get-Process -Id $env:QL_PARENT -ErrorAction SilentlyContinue)){exit}
  $h=[FG]::GetForegroundWindow()
  if($h -ne [IntPtr]::Zero){
    $sb=New-Object Text.StringBuilder 256;[void][FG]::GetWindowText($h,$sb,256)
    $p=0;[void][FG]::GetWindowThreadProcessId($h,[ref]$p)
    $n=(Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
    $o=@{process=$n;title=$sb.ToString()}|ConvertTo-Json -Compress
    if($o -ne $last){[Console]::Out.WriteLine($o);[Console]::Out.Flush();$last=$o}
  }
  Start-Sleep -Seconds 5
}`;

const MAX_EVENTS = 200;
const MAX_RESPAWNS = 3;
let child = null;
let events = [];
let respawns = 0;
let running = false;
let respawnTimer = null;
let onEvent = () => {};

function spawnChild() {
  const enc = Buffer.from(PS, 'utf16le').toString('base64');
  const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
    { windowsHide: true, env: { ...process.env, QL_PARENT: String(process.pid) } });
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
        if (e.process && e.title !== 'Questling') {
          events.push({ ts: Date.now(), process: e.process, title: e.title || '' });
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

function start(cb) {
  if (running) return;
  running = true;
  respawns = 0;
  if (cb) onEvent = cb;
  spawnChild();
}

function stop() {
  running = false;
  clearTimeout(respawnTimer);
  events = []; // screen-derived: drop on pause
  if (child) { child.kill(); child = null; }
}

const current = () => events[events.length - 1] || null;
const summary = (since, now, opts) => focusSummary(events, since, now, opts);

module.exports = { start, stop, current, summary };
