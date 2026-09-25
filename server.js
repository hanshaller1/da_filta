const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const HOST = '127.0.0.1';
const ROOT = fs.realpathSync(__dirname);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac'
};

const insideRoot = filePath => filePath === ROOT || filePath.startsWith(ROOT + path.sep);

function resolveRequestPath(url) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(url || '').split(/[?#]/, 1)[0]);
  } catch {
    return { status: 400 };
  }
  if (!decoded.startsWith('/') || decoded.includes('\0')) return { status: 400 };
  // Treat both separator spellings as separators, including on Windows.
  const normalized = decoded.replace(/\\/g, '/');
  const filePath = path.resolve(ROOT, '.' + (normalized === '/' ? '/index.html' : normalized));
  return insideRoot(filePath) ? { filePath } : { status: 403 };
}

function createServer() {
  return http.createServer((req, res) => {
    const resolved = resolveRequestPath(req.url);
    if (resolved.status) {
      res.writeHead(resolved.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(resolved.status === 403 ? '403 - Zugriff verweigert' : '400 - Ungültiger Pfad');
      return;
    }
    fs.realpath(resolved.filePath, (pathError, canonicalPath) => {
      if (pathError) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 - Datei nicht gefunden');
        return;
      }
      if (!insideRoot(canonicalPath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 - Zugriff verweigert');
        return;
      }
      fs.readFile(canonicalPath, (error, data) => {
        if (error) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 - Datei nicht gefunden');
          return;
        }
        const ext = path.extname(canonicalPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Server läuft auf http://${HOST}:${PORT}`);
  });
}

module.exports = { createServer, resolveRequestPath };
