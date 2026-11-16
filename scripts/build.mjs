// Assembles the deployable site in dist/.
//
// The app needs no compilation. This copies the files a browser should be served (so that
// tests, tooling, docs and node_modules never get published), writes the sitemap, names
// scripts, styles, fonts and data after their content (scripts/fingerprint.mjs), and stamps
// the service worker with the version. `npm run build` runs it; CI deploys what it writes.

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fingerprint } from './fingerprint.mjs';
import { sitemapXml } from './sitemap.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const PUBLISH = [
    'index.html', '404.html', 'styles.css', 'sw.js', 'manifest.json',
    'favicon.ico', 'favicon.svg', '_headers', 'robots.txt', '_routes.json',
    'faq', 'spots', 'drawings', 'icons', 'fonts', 'js', 'data', 'vendor', 'screenshots',
];

// Published under a name that carries a hash of the content, and cached by browsers for good
// (the rules are added to _headers below). Everything in these must be loaded by a path the
// build can see and rewrite. Left under fixed names: the pages, sw.js, and what other
// software holds on to by address (the manifest, icons, link-preview images).
const FINGERPRINT = ['styles.css', 'js', 'fonts', 'vendor', 'data'];
const isLicence = (path) => /(?:^|\/)LICENSE(?:\.[a-z]+)?$/.test(path); // nothing loads these
const within = (path, entry) => path === entry || path.startsWith(`${entry}/`);
const fingerprinted = (path) => FINGERPRINT.some((entry) => within(path, entry)) && !isLicence(path);

function fail(message) {
    console.error(message);
    process.exit(1);
}

async function listFiles(dir) {
    const files = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(path));
        else files.push(path);
    }
    return files;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of PUBLISH) {
    await cp(join(root, entry), join(dist, entry), { recursive: true });
}

// The sitemap: the pages and every place they link to. Written before the files are hashed
// below, so a change to the list is a new version like any other.
const page = (path) => readFile(join(dist, path), 'utf8');
await writeFile(join(dist, 'sitemap.xml'), sitemapXml(await page('index.html'), {
    '/spots/': await page('spots/index.html'),
    '/faq/': await page('faq/index.html'),
}));

// Fingerprint: rename, and rewrite every reference in the pages, styles, scripts and sw.js.
const published = new Map();
for (const path of await listFiles(dist)) {
    published.set(relative(dist, path).split(sep).join('/'), await readFile(path));
}
const { files: renamed, names, referrers } = fingerprint(published, fingerprinted);

// A file nothing refers to is loaded by a path put together at run time, which the build
// cannot rewrite: in production that request would be a 404. (sw.js lists every file, so it
// does not count as a referrer.)
const unseen = [...referrers].filter(([, from]) => [...from].every((path) => path === 'sw.js')).map(([path]) => path);
if (unseen.length) {
    fail(`Nothing refers to these by a path the build can rewrite (write the path out in full where it is loaded): ${unseen.join(', ')}`);
}

for (const [path, content] of renamed) {
    if (published.get(path) === content) continue; // same name, same bytes
    await writeFile(join(dist, path), content);
}
for (const path of names.keys()) await rm(join(dist, path));

// A fingerprinted name never has other content, so browsers and Cloudflare may keep it for
// good. One rule per folder (Pages allows 100 rules), which is why the folders above must
// hold nothing but fingerprinted files and licence texts.
const forever = FINGERPRINT.map((entry) => (names.has(entry) ? `/${names.get(entry)}` : `/${entry}/*`));
await writeFile(join(dist, '_headers'), [
    (await readFile(join(dist, '_headers'), 'utf8')).trimEnd(),
    '',
    '# Added by the build: files named after their content never change.',
    ...forever.flatMap((path) => [path, '  Cache-Control: public, max-age=31536000, immutable']),
    '',
].join('\n'));

// Fail the build if the service worker would precache a file that is not being published
// (a missing file makes the whole offline install fail silently in the browser), or would
// leave out a script, style, font or data file (the app would then break offline).
const sw = await readFile(join(dist, 'sw.js'), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
const missing = [];
for (const file of shell) {
    if (file === './') continue;
    await stat(join(dist, file)).catch(() => missing.push(file));
}
if (missing.length) fail(`sw.js lists files that are not published: ${missing.join(', ')}`);
const unlisted = [...names].filter(([, name]) => !shell.includes(name)).map(([path]) => path);
if (unlisted.length) fail(`sw.js does not list these files, so they would be missing offline: ${unlisted.join(', ')}`);

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
if (!cacheLine.test(sw)) fail('sw.js has no "const CACHE = \'...\';" line to stamp with the build version');
await writeFile(join(dist, 'sw.js'), sw.replace(cacheLine, `const CACHE = 'htb-shell-${version}';`));

console.log(`Built dist/ (${(await listFiles(dist)).length} files, ${names.size} fingerprinted, version ${version})`);
