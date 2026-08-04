import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
};

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8', method = 'GET') {
  const buffer = Buffer.from(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': contentType, 'Content-Length': buffer.length });
  if (method === 'HEAD') res.end(); else res.end(buffer);
}

function errorPage(status, title, detail) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${status} ${title}</title><style>body{font-family:system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#e4dfd0;color:#292720}.card{max-width:620px;padding:32px;border:1px solid #766f5f;background:#f0eadb}h1{margin-top:0}code{background:#ddd4c0;padding:2px 5px}</style><div class="card"><h1>${status} ${title}</h1><p>${detail}</p><p><a href="/">返回作品</a></p></div></html>`;
}

function safeResolve(requestUrl) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(requestUrl || '/', 'http://localhost').pathname); }
  catch { return { error: 400, message: '请求路径无法解析。' }; }
  if (pathname.includes('\0')) return { error: 400, message: '请求路径包含非法字符。' };
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const absolute = path.resolve(ROOT, relative);
  const rootWithSeparator = `${ROOT}${path.sep}`;
  if (absolute !== path.join(ROOT, 'index.html') && !absolute.startsWith(rootWithSeparator)) {
    return { error: 403, message: '禁止访问项目目录以外的路径。' };
  }
  return { absolute, relative };
}

export function createAppServer() {
  return http.createServer((req, res) => {
    const method = req.method || 'GET';
    if (!['GET', 'HEAD'].includes(method)) {
      res.setHeader('Allow', 'GET, HEAD');
      send(res, 405, errorPage(405, 'Method Not Allowed', '本地作品服务器只接受 GET 和 HEAD。'), 'text/html; charset=utf-8', method);
      return;
    }
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/health' || pathname === '/healthz') {
      const body = JSON.stringify({ ok: true, app: PACKAGE.name, version: PACKAGE.version, baseline: 'ac76d30', uptimeSeconds: Math.round(process.uptime() * 10) / 10 });
      send(res, 200, body, 'application/json; charset=utf-8', method);
      return;
    }
    const resolved = safeResolve(req.url);
    if (resolved.error) {
      send(res, resolved.error, errorPage(resolved.error, resolved.error === 403 ? 'Forbidden' : 'Bad Request', resolved.message), 'text/html; charset=utf-8', method);
      return;
    }
    fs.stat(resolved.absolute, (error, stat) => {
      if (error || !stat.isFile()) {
        send(res, 404, errorPage(404, 'Not Found', `未找到文件：<code>${resolved.relative}</code>`), 'text/html; charset=utf-8', method);
        return;
      }
      const extension = path.extname(resolved.absolute).toLowerCase();
      const headers = {
        ...SECURITY_HEADERS,
        'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
        'Content-Length': stat.size,
      };
      res.writeHead(200, headers);
      if (method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(resolved.absolute);
      stream.on('error', (streamError) => {
        if (!res.headersSent) send(res, 500, errorPage(500, 'Read Error', streamError.message), 'text/html; charset=utf-8');
        else res.destroy(streamError);
      });
      stream.pipe(res);
    });
  });
}

function parsePort() {
  const argument = process.argv.find((item) => item.startsWith('--port='));
  const raw = argument ? argument.split('=')[1] : process.env.PORT || '4173';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`端口无效：${raw}`);
  return port;
}

export async function startServer() {
  const port = parsePort();
  const host = process.env.HOST || '0.0.0.0';
  const server = createAppServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') console.error(`\n启动失败：端口 ${port} 已被占用。关闭占用程序，或执行 PORT=4174 npm start。\n`);
    else if (error.code === 'EACCES') console.error(`\n启动失败：没有权限监听端口 ${port}。请选择 1024 以上端口。\n`);
    else console.error(`\n本地服务器启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const address of list || []) if (address.family === 'IPv4' && !address.internal) addresses.push(address.address);
  }
  console.log('\n汉画像·百戏乐舞 V4 Motion 已启动');
  console.log(`本机： http://localhost:${port}`);
  for (const address of addresses) console.log(`局域网： http://${address}:${port}`);
  console.log(`健康检查： http://localhost:${port}/health`);
  console.log('按 Ctrl+C 停止。\n');
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
