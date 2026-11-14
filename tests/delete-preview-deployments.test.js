import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectForBranch } from '../scripts/delete-preview-deployments.mjs';

const deployment = (id, environment, branch) => ({ id, environment, deployment_trigger: { metadata: { branch } } });

test('only previews on exactly the closed branch are selected', () => {
    const list = [
        deployment('a', 'preview', 'pr-12'),
        deployment('b', 'preview', 'pr-120'),
        deployment('c', 'preview', 'pr-1'),
        deployment('d', 'production', 'pr-12'),
        deployment('e', 'production', 'main'),
        deployment('f', 'preview', 'pr-12'),
        { id: 'g', environment: 'preview' },
    ];
    assert.deepEqual(selectForBranch(list, 'pr-12').map((d) => d.id), ['a', 'f']);
});

test('refuses to run for production or without a branch', () => {
    assert.throws(() => selectForBranch([], 'main'));
    assert.throws(() => selectForBranch([], ''));
    assert.throws(() => selectForBranch([], undefined));
});
