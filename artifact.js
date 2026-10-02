// Long-work text for the check prompt: live Word text (COM), or a file the user linked.
// Read on demand, kept in memory only, capped. Any failure -> null (screen-only judging).
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const CAP = 400000; // hard safety cap only; the model-facing cap (capMiddle) is applied in main
const PS_HEAD = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference='Stop';";

function ps(script, env = {}) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_HEAD + script],
      { env: { ...process.env, ...env }, timeout: 8000, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout));
  });
}

const cap = (t) => (t && t.trim() ? t.slice(0, CAP) : null);

/** Unsaved live text of the active Word document (Word must be running). */
async function wordLive() {
  return cap(await ps("[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application').ActiveDocument.Content.Text"));
}

/** Text of a linked file. .docx is read through a shared-read stream so it works while Word has it open. */
async function readFile(file) {
  if (typeof file !== 'string' || !file) return null;
  if (/\.docx$/i.test(file)) {
    const out = await ps(
      "Add-Type -AssemblyName System.IO.Compression;" +
      "$fs=New-Object IO.FileStream($env:QL_FILE,'Open','Read','ReadWrite');" +
      "$za=New-Object IO.Compression.ZipArchive($fs);" +
      "$sr=New-Object IO.StreamReader($za.GetEntry('word/document.xml').Open(),[Text.Encoding]::UTF8);" +
      "$x=$sr.ReadToEnd();$fs.Dispose();" +
      "$t=($x -replace '</w:p>',\"`n\") -replace '<[^>]+>','';" +
      "$t.Replace('&lt;','<').Replace('&gt;','>').Replace('&quot;','\"').Replace('&apos;',\"'\").Replace('&amp;','&')",
      { QL_FILE: file });
    return cap(out);
  }
  if (!/\.(txt|md|js|ts|py|json|html|css|java|c|cpp|cs|go|rs|tex)$/i.test(path.extname(file) ? file : '')) return null;
  try {
    if ((await fs.stat(file)).size > 2 * 1024 * 1024) return null;
    return cap(await fs.readFile(file, 'utf8'));
  } catch { return null; }
}

/** Best text for "what is the user working on": Word's live text when the PICKED window is Word, else the linked file.
 * An unknown or different process never triggers a Word read (that would send another app's document). */
async function getText({ focusProc, linkedPath }) {
  if (focusProc && /^winword$/i.test(focusProc)) {
    const live = await wordLive();
    if (live) return { text: live, source: 'word-live' };
  }
  if (linkedPath) {
    const t = await readFile(linkedPath);
    if (t) return { text: t, source: 'file' };
  }
  return null;
}

module.exports = { getText, readFile, wordLive };
