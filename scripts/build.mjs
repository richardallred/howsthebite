// Assembles the deployable site in dist/.
//
// The app needs no compilation; this just copies the files a browser should be
// served, so that tests, tooling, docs and node_modules never get published.
// Cloudflare Pages runs it as the build command (see wrangler.toml).

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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

// Name the offline cache after the content being published. Any change to any file then
// changes sw.js, which is how browsers notice a new version (and the app reloads itself
// when one takes over). Nobody has to remember to bump a version number.
async function contentHash(dir, hash = createHash('sha256')) {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await contentHash(path, hash);
        else if (path !== join(dist, 'sw.js')) hash.update(entry.name).update(await readFile(path));
    }
    return hash;
}
const version = (await contentHash(dist)).update(sw).digest('hex').slice(0, 12);
const cacheLine = /const CACHE = '[^']*';/;
if (!cacheLine.test(sw)) {
    console.error('sw.js has no "const CACHE = \'...\';" line to stamp with the build version');
    process.exit(1);
}
await writeFile(join(dist, 'sw.js'), sw.replace(cacheLine, `const CACHE = 'htb-shell-${version}';`));

async function count(dir) {
    let files = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        files += entry.isDirectory() ? await count(join(dir, entry.name)) : 1;
    }
    return files;
}
console.log(`Built dist/ (${await count(dist)} files, version ${version})`);
