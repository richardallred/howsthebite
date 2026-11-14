// Static server for local development and the browser tests: `node scripts/serve.mjs [port]`.
//
// Serves the source tree the way Cloudflare Pages serves dist/, as far as the app can tell:
// - place addresses (/fishing/…) get index.html, as the Pages Function serves them (the
//   function also writes the place into the title and meta tags; `npm run preview` runs it);
// - anything else that is not a file gets 404.html with a 404 status;
// - nothing is cached, so an edit shows up on the next reload.
// Dotfiles (.dev.vars holds the USGS key) are never served. Listens on localhost only.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 8000);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
};

async function fileFor(pathname) {
    if (pathname.startsWith('/fishing/') || pathname === '/fishing') return join(root, 'index.html');
    if (pathname.split('/').some((part) => part.startsWith('.'))) return null;
    const path = resolve(root, `.${pathname}`);
    if (path !== root && !path.startsWith(root + sep)) return null;
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory()) return fileFor(`${pathname.replace(/\/$/, '')}/index.html`);
    return info?.isFile() ? path : null;
}

createServer(async (request, response) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
        pathname = '/404';
    }
    const found = await fileFor(pathname);
    const path = found ?? join(root, '404.html');
    response.writeHead(found ? 200 : 404, {
        'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).pipe(response);
}).listen(port, 'localhost', () => {
    console.log(`Serving ${root} at http://localhost:${port}/`);
});
