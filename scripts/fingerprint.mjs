// Names published files after their content: js/app.js becomes js/app.3f9c2a7b1e.js.
//
// Why: a name that changes whenever the file does can be cached forever, and nothing can
// run an old copy against a new page. Google's renderer in particular keeps scripts and
// styles longer than the cache headers allow, and its documentation asks for exactly this.
//
// How a file is named: by a hash of the file and of every file it refers to, directly or
// through others. So changing one module renames it and everything that imports it, and
// leaves the rest (fonts, the map library, an untouched module) at the address browsers
// already hold.
//
// The source tree is not touched and still runs as it is (npm start, the tests). The build
// (scripts/build.mjs) applies this to the copy in dist/.

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const HASH_LENGTH = 10;

/** A fingerprinted name. sw.js carries the same pattern; tests/fingerprint.test.js keeps them equal. */
export const FINGERPRINTED = /\.[0-9a-f]{10}\.[a-z0-9]+$/;

const KIND = /\.(html|css|js)$/;

// Where each kind of file names another. Group 2 is the reference.
const PATTERNS = {
    html: /\b(?:href|src)=(["'])([^"']+)\1/dg,
    css: /url\(\s*(["']?)([^"')]+)\1\s*\)/dg,
    // Any quoted path: `import … from './x.js'`, `import('./x.js')`, a path handed to fetch()
    // or to a <script> element, and the service worker's list.
    js: /(["'`])([\w@./-]+\.[a-z0-9]+(?:[?#][^"'`\s]*)?)\1/dg,
};

/** The published path a reference in `from` points at, or null if it is not a path within the site. */
function resolve(from, ref, kind) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null; // another site, data:, an anchor
    const path = ref.replace(/[?#].*$/, '');
    if (!path) return null;
    const dir = posix.dirname(from);
    const rooted = path.startsWith('/');
    // In a script, a bare 'name.js' is a path only at the site root (the service worker's list).
    if (kind === 'js' && !rooted && !/^\.{1,2}\//.test(path) && dir !== '.') return null;
    const target = posix.normalize(rooted ? path.slice(1) : posix.join(dir, path));
    return target.startsWith('../') ? null : target;
}

/**
 * Every reference in a file that could name another published file.
 * @returns {Array<{ start: number, end: number, ref: string, target: string }>} in order of appearance
 */
export function references(path, text) {
    const kind = path.match(KIND)?.[1];
    if (!kind) return [];
    const found = [];
    for (const match of text.matchAll(PATTERNS[kind])) {
        const target = resolve(path, match[2], kind);
        if (target === null) continue;
        const [start, end] = match.indices[2];
        found.push({ start, end, ref: match[2], target });
    }
    return found;
}

/** 'js/app.js' + hash -> 'js/app.<hash>.js' */
function withHash(path, hash) {
    if (!/\.[a-z0-9]+$/i.test(posix.basename(path))) throw new Error(`Cannot fingerprint a file with no extension: ${path}`);
    return path.replace(/(\.[a-z0-9]+)$/i, `.${hash}$1`);
}

/** The reference as written, pointing at the renamed file: same directory part, same ?query or #fragment. */
function renamedRef(ref, newPath) {
    const cut = ref.search(/[?#]/);
    const path = cut === -1 ? ref : ref.slice(0, cut);
    const rest = cut === -1 ? '' : ref.slice(cut);
    return path.slice(0, path.lastIndexOf('/') + 1) + posix.basename(newPath) + rest;
}

/**
 * Rename the wanted files after their content and rewrite every reference to them.
 *
 * @param {Map<string, Buffer>} files  published path ('js/app.js') -> content
 * @param {(path: string) => boolean} wanted  which files to rename
 * @returns {{
 *   files: Map<string, Buffer>,           the same site under its new names
 *   names: Map<string, string>,           old path -> new path, for the renamed files
 *   referrers: Map<string, Set<string>>,  old path of a renamed file -> the files that refer to it
 * }}
 */
export function fingerprint(files, wanted) {
    const chosen = new Set([...files.keys()].filter(wanted));

    const refs = new Map(); // path -> its references to chosen files
    const referrers = new Map([...chosen].map((path) => [path, new Set()]));
    for (const [path, content] of files) {
        const own = references(path, content.toString('utf8')).filter((ref) => chosen.has(ref.target));
        if (own.length) refs.set(path, own);
        for (const ref of own) if (ref.target !== path) referrers.get(ref.target).add(path);
    }

    // Everything a file reaches. Hashing that set (rather than hashing files after their
    // references are rewritten) gives the same guarantee and does not mind modules that
    // import each other in a circle.
    const reach = (path, seen = new Set()) => {
        if (seen.has(path)) return seen;
        seen.add(path);
        for (const ref of refs.get(path) ?? []) reach(ref.target, seen);
        return seen;
    };

    const names = new Map();
    for (const path of chosen) {
        const hash = createHash('sha256');
        for (const member of [...reach(path)].sort()) hash.update(member).update('\0').update(files.get(member)).update('\0');
        names.set(path, withHash(path, hash.digest('hex').slice(0, HASH_LENGTH)));
    }

    const renamed = new Map();
    for (const [path, content] of files) {
        let body = content;
        const own = refs.get(path);
        if (own) {
            const text = content.toString('utf8');
            let rewritten = '';
            let at = 0;
            for (const ref of own) {
                rewritten += text.slice(at, ref.start) + renamedRef(ref.ref, names.get(ref.target));
                at = ref.end;
            }
            body = Buffer.from(rewritten + text.slice(at));
        }
        renamed.set(names.get(path) ?? path, body);
    }
    return { files: renamed, names, referrers };
}
