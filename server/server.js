/**
 * GentlyOS HTTP Install Server
 * Serves the installer and runtime package
 *
 * Usage:
 *   node server.js [port]
 *
 * Then on client:
 *   curl -fsSL http://SERVER:PORT/install | bash
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || process.env.PORT || 8080;
const SERVER_DIR = __dirname;
const DIST_DIR = path.join(SERVER_DIR, '..', 'dist');

// MIME types
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.tar.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.sh': 'text/x-shellscript',
  '': 'text/plain'
};

// Get local IP
function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Serve file
function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length
    });
    res.end(data);
  });
}

// Request handler
function handler(req, res) {
  const url = req.url.split('?')[0];

  console.log(`[${new Date().toISOString()}] ${req.method} ${url}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Routes
  switch (url) {
    case '/':
    case '/index.html':
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>GentlyOS Installer</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #e2e8f0; padding: 2rem; }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { color: #8b5cf6; }
    pre { background: #1a1a2e; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
    code { color: #22c55e; }
    a { color: #8b5cf6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>GentlyOS</h1>
    <p>Self-evolving operating system with neural graph learning.</p>

    <h2>Quick Install</h2>
    <pre><code>curl -fsSL http://${getLocalIP()}:${PORT}/install | bash</code></pre>

    <h2>With Dependencies</h2>
    <pre><code>curl -fsSL http://${getLocalIP()}:${PORT}/install | bash -s -- --with-deps</code></pre>

    <h2>Manual Download</h2>
    <p><a href="/gentlyos-0.1.0-runtime.tar.gz">gentlyos-0.1.0-runtime.tar.gz</a></p>

    <h2>License</h2>
    <p>Free for personal use. Enterprise requires license.</p>
  </div>
</body>
</html>`);
      break;

    case '/install':
    case '/install.sh':
      // Inject server URL into install script
      fs.readFile(path.join(SERVER_DIR, 'install'), 'utf-8', (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('Server error');
          return;
        }

        // Replace server URL
        const ip = getLocalIP();
        const serverUrl = 'http://' + ip + ':' + PORT;
        const script = data.replace(
          'SERVER="${GENTLYOS_SERVER:-http://localhost:8080}"',
          'SERVER="' + serverUrl + '"'
        );

        res.writeHead(200, { 'Content-Type': 'text/x-shellscript' });
        res.end(script);
      });
      break;

    case '/gentlyos-0.1.0-runtime.tar.gz':
    case '/runtime.tar.gz':
      const tarPath = path.join(DIST_DIR, 'gentlyos-0.1.0-runtime.tar.gz');
      if (fs.existsSync(tarPath)) {
        serveFile(res, tarPath, 'application/gzip');
      } else {
        res.writeHead(404);
        res.end('Package not found. Run ./build.sh first.');
      }
      break;

    case '/health':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
      break;

    default:
      res.writeHead(404);
      res.end('Not found');
  }
}

// Start server
const server = http.createServer(handler);

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              GentlyOS Install Server                             ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Server running on:                                              ║
║    http://localhost:${PORT}                                          ║
║    http://${ip}:${PORT}                                       ║
║                                                                  ║
║  Install command:                                                ║
║    curl -fsSL http://${ip}:${PORT}/install | bash             ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
  `);
});
