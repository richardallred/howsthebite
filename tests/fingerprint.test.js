// The build's content-fingerprinted file names (scripts/fingerprint.mjs).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { FINGERPRINTED, fingerprint, references } from '../scripts/fingerprint.mjs';

const site = (files) => new Map(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)]));
const text = (result, path) => result.files.get(path).toString();
const assets = (path) => /^(?:styles\.css|js\/|fonts\/|data\/)/.test(path);

const SOURCE = {
    'index.html': '<link rel="stylesheet" href="/styles.css"><link rel="icon" href="/favicon.svg">'
        + '<a href="https://example.com/js/app.js">elsewhere</a><script type="module" src="/js/app.js"></script>',
    'favicon.svg': '<svg/>',
    'styles.css': '@font-face { src: url("fonts/a.woff2") format("woff2"); } .x { background: url(data:image/png;base64,AAAA); }',
    'fonts/a.woff2': 'font bytes',
    'data/list.json': '[1]',
    'js/app.js': "import { a } from './core/a.js';\nimport './ui/b.js';\nconst lazy = () => import('./core/c.js');\nnavigator.serviceWorker.register('sw.js');",
    'js/core/a.js': "import { b } from '../ui/b.js';\nexport const a = fetch('/data/list.json?fresh=1');",
    'js/ui/b.js': "export const b = 'app.js';",
    'js/core/c.js': 'export const c = 3;',
    'sw.js': "const SHELL = ['./', 'index.html', 'styles.css', 'fonts/a.woff2', 'js/app.js', 'js/core/a.js', 'js/ui/b.js', 'js/core/c.js', 'data/list.json'];",
};

test('the chosen files are renamed after their content and the rest keep their names', () => {
    const { files, names } = fingerprint(site(SOURCE), assets);
    assert.deepEqual([...names.keys()].sort(), ['data/list.json', 'fonts/a.woff2', 'js/app.js', 'js/core/a.js', 'js/core/c.js', 'js/ui/b.js', 'styles.css']);
    for (const [from, to] of names) {
        assert.match(to, FINGERPRINTED, to);
        assert.equal(to.replace(/\.[0-9a-f]{10}(\.[a-z0-9]+)$/, '$1'), from);
        assert.ok(files.has(to) && !files.has(from));
    }
    for (const kept of ['index.html', 'favicon.svg', 'sw.js']) assert.ok(files.has(kept), kept);
    assert.equal(files.size, Object.keys(SOURCE).length);
});

test('every reference is rewritten: pages, styles, imports, quoted paths and the service worker list', () => {
    const result = fingerprint(site(SOURCE), assets);
    const name = (path) => result.names.get(path);
    const base = (path) => name(path).split('/').pop();

    const html = text(result, 'index.html');
    assert.ok(html.includes(`href="/${name('styles.css')}"`));
    assert.ok(html.includes(`src="/${name('js/app.js')}"`));
    assert.ok(html.includes('href="/favicon.svg"'), 'a file that is not fingerprinted keeps its address');
    assert.ok(html.includes('href="https://example.com/js/app.js"'), 'another site is left alone');

    const css = text(result, name('styles.css'));
    assert.ok(css.includes(`url("fonts/${base('fonts/a.woff2')}")`));
    assert.ok(css.includes('url(data:image/png;base64,AAAA)'));

    const app = text(result, name('js/app.js'));
    assert.ok(app.includes(`from './core/${base('js/core/a.js')}'`));
    assert.ok(app.includes(`import './ui/${base('js/ui/b.js')}'`));
    assert.ok(app.includes(`import('./core/${base('js/core/c.js')}')`));
    assert.ok(app.includes("register('sw.js')"));

    const a = text(result, name('js/core/a.js'));
    assert.ok(a.includes(`from '../ui/${base('js/ui/b.js')}'`));
    assert.ok(a.includes(`fetch('/${name('data/list.json')}?fresh=1')`), 'a query string is kept');

    // A bare 'app.js' inside js/ui/ is a word, not a path.
    assert.equal(text(result, name('js/ui/b.js')), SOURCE['js/ui/b.js']);

    const shell = [...text(result, 'sw.js').matchAll(/'([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(shell, ['./', 'index.html', ...['styles.css', 'fonts/a.woff2', 'js/app.js', 'js/core/a.js', 'js/ui/b.js', 'js/core/c.js', 'data/list.json'].map(name)]);
});

test('changing a file renames it and everything that reaches it, and nothing else', () => {
    const before = fingerprint(site(SOURCE), assets).names;
    const after = fingerprint(site({ ...SOURCE, 'js/ui/b.js': "export const b = 'changed';" }), assets).names;
    const changed = [...before.keys()].filter((path) => before.get(path) !== after.get(path)).sort();
    assert.deepEqual(changed, ['js/app.js', 'js/core/a.js', 'js/ui/b.js']);
});

test('the same content always gets the same name', () => {
    assert.deepEqual([...fingerprint(site(SOURCE), assets).names], [...fingerprint(site(SOURCE), assets).names]);
});

test('modules that import each other in a circle are handled', () => {
    const circle = {
        'js/a.js': "import './b.js'; export const a = 1;",
        'js/b.js': "import './a.js'; export const b = 2;",
    };
    const first = fingerprint(site(circle), assets);
    assert.ok(text(first, first.names.get('js/a.js')).includes(first.names.get('js/b.js').slice(3)));
    assert.ok(text(first, first.names.get('js/b.js')).includes(first.names.get('js/a.js').slice(3)));
    const second = fingerprint(site({ ...circle, 'js/b.js': "import './a.js'; export const b = 3;" }), assets);
    assert.notEqual(second.names.get('js/a.js'), first.names.get('js/a.js'));
    assert.notEqual(second.names.get('js/b.js'), first.names.get('js/b.js'));
});

test('it reports which files refer to each renamed file, so the build can refuse one nothing refers to', () => {
    const { referrers } = fingerprint(site({ ...SOURCE, 'js/orphan.js': 'export {};' }), assets);
    assert.deepEqual([...referrers.get('js/core/c.js')].sort(), ['js/app.js', 'sw.js']);
    assert.deepEqual([...referrers.get('js/orphan.js')], []);
});

test('references outside the site are not followed', () => {
    assert.deepEqual(references('js/app.js', "import x from '../../outside.js'; fetch('//cdn.example/x.js');"), []);
    assert.deepEqual(references('notes.txt', "href='/styles.css'"), []);
});

test('a file with no extension cannot be fingerprinted', () => {
    assert.throws(() => fingerprint(site({ 'js/LICENSE': 'text' }), assets), /no extension/);
});

test('the service worker recognises fingerprinted names by the same pattern as the build', async () => {
    const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    assert.ok(sw.includes(`const FINGERPRINTED = ${FINGERPRINTED};`));
});

test('the page names its author', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<meta name="author" content="Richard Allred">/);
    assert.match(html, /<footer class="app-footer">[\s\S]*Made by <a href="https:\/\/github.com\/richardallred"[^>]*>Richard Allred<\/a> and <a href="https:\/\/github.com\/zgutterm"[^>]*>Zach Gutterman<\/a>\.[\s\S]*<\/footer>/);
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
    const author = graph.find((node) => node['@type'] === 'Person');
    assert.equal(author.name, 'Richard Allred');
    assert.equal(graph.find((node) => node['@type'] === 'WebSite').publisher['@id'], author['@id']);
    assert.equal(graph.find((node) => node['@type'] === 'WebApplication').author['@id'], author['@id']);
});
