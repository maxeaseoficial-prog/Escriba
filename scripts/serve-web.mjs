import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, process.argv.includes('--dist') ? 'dist' : 'web');
const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const requested = pathname === '/' ? '/index.html' : pathname;
    const staticSource = !process.argv.includes('--dist') && requested.startsWith('/static/');
    const allowed = staticSource ? path.join(root, 'escriba') : base;
    const target = path.resolve(allowed, `.${requested}`);
    if (!target.startsWith(allowed + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(target);
    for (const item of config.headers[0].headers) res.setHeader(item.key, item.value);
    res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.writeHead(200).end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end('Arquivo não encontrado.'); }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log('Escriba: http://localhost:' + (process.env.PORT || 4173)));
