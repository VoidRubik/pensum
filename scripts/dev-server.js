// Local stand-in for Vercel: serves public/ and routes POST /api/model to api/model.js.
//   node web/build.js && node scripts/dev-server.js [port]     (GEMINI_API_KEY from .env)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const handler = require(path.join(root, 'api', 'model.js'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' };
const PORT = Number(process.argv[2]) || 4173;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
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
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.join(root, 'public', rel);
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`dev server http://127.0.0.1:${PORT}`));
