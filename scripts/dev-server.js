// Local stand-in for Vercel: serves public/ and routes POST /api/model to api/model.js.
//   node web/build.js && node scripts/dev-server.js [port]     (GEMINI_API_KEY from .env)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' };

// Absolute path of a file inside public/, or null (malformed escape, NUL byte, or outside public/).
function resolvePublic(rootDir, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath); } catch { return null; }
  if (rel.includes('\0')) return null;
  const pub = path.join(rootDir, 'public');
  const file = path.join(pub, rel);
  return file.startsWith(pub + path.sep) ? file : null;
}
module.exports = { resolvePublic };

if (require.main === module) {
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const handler = require(path.join(root, 'api', 'model.js'));
const PORT = Number(process.argv[2]) || 4173;

http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.statusCode = 400; return res.end('bad request'); }
  if (url.pathname === '/api/model') {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = undefined; }
      const r = Object.assign(res, {
        status(c) { res.statusCode = c; return res; },
        json(o) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); },
      });
      handler(req, r);
    });
    return;
  }
  const file = resolvePublic(root, url.pathname);
  if (!file) { res.statusCode = 400; return res.end('bad request'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`dev server http://127.0.0.1:${PORT}`));
}
