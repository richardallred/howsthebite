// Deletes every Cloudflare Pages preview deployment made for one branch, e.g. a closed pull
// request's "pr-12". The CI/CD workflow runs it when a pull request is merged or closed.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//     node scripts/delete-preview-deployments.mjs --branch pr-12 [--dry-run]
//
// Only preview deployments whose branch matches exactly are touched; production is never
// deleted. This calls the API directly rather than `wrangler pages deployment list`, because
// wrangler only reads the first page of deployments and would miss older ones.

import { pathToFileURL } from 'node:url';

export const PROJECT = 'howsthebite';
const API = 'https://api.cloudflare.com/client/v4';
const PER_PAGE = 25;

/** The deployments to delete for a branch: previews on exactly that branch, nothing else. */
export function selectForBranch(deployments, branch) {
    if (!branch || branch === 'main') throw new Error(`refusing to delete deployments for branch "${branch}"`);
    return deployments.filter((d) => d.environment === 'preview' && d.deployment_trigger?.metadata?.branch === branch);
}

async function call(path, { token, method = 'GET' }) {
    const response = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
        const detail = body.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || response.statusText;
        throw new Error(`${method} ${path} failed (${response.status}): ${detail}`);
    }
    return body;
}

async function listPreviews({ account, token }) {
    const all = [];
    for (let page = 1; ; page++) {
        const body = await call(
            `/accounts/${account}/pages/projects/${PROJECT}/deployments?env=preview&page=${page}&per_page=${PER_PAGE}`,
            { token },
        );
        all.push(...body.result);
        const totalPages = body.result_info?.total_pages;
        if (!body.result.length || (totalPages && page >= totalPages)) return all;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const branch = args[args.indexOf('--branch') + 1];
    const dryRun = args.includes('--dry-run');
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!args.includes('--branch') || !branch) throw new Error('usage: --branch <name> [--dry-run]');
    selectForBranch([], branch); // refuse "main" before touching the API
    if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');

    // Collect everything first: deleting while paging would shift later pages.
    const previews = await listPreviews({ account, token });
    const doomed = selectForBranch(previews, branch);
    console.log(`${previews.length} preview deployments in ${PROJECT}; ${doomed.length} on branch ${branch}`);

    for (const d of doomed) {
        if (dryRun) {
            console.log(`would delete ${d.id} ${d.url}`);
            continue;
        }
        // force: the newest deployment holds the branch alias, which otherwise blocks deletion.
        await call(`/accounts/${account}/pages/projects/${PROJECT}/deployments/${d.id}?force=true`, { token, method: 'DELETE' });
        console.log(`deleted ${d.id} ${d.url}`);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
