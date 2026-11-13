// Assembles the deployable site in dist/.
//
// The app needs no compilation; this just copies the files a browser should be
// served, so that tests, tooling, docs and node_modules never get published.
// Cloudflare Pages runs it as the build command (see wrangler.toml).

import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const PUBLISH = [
    'index.html', '404.html', 'styles.css', 'sw.js', 'manifest.json',
    'favicon.ico', 'favicon.svg', '_headers',
    'icons', 'js', 'vendor', 'screenshots',
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of PUBLISH) {
    await cp(join(root, entry), join(dist, entry), { recursive: true });
}

// Fail the build if the service worker would precache a file that is not being published
// (a missing file makes the whole offline install fail silently in the browser).
const sw = await readFile(join(dist, 'sw.js'), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
const missing = [];
for (const file of shell) {
    if (file === './') continue;
    await stat(join(dist, file)).catch(() => missing.push(file));
}
if (missing.length) {
    console.error(`sw.js lists files that are not published: ${missing.join(', ')}`);
    process.exit(1);
}

async function count(dir) {
    let files = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        files += entry.isDirectory() ? await count(join(dir, entry.name)) : 1;
    }
    return files;
}
console.log(`Built dist/ (${await count(dist)} files)`);
