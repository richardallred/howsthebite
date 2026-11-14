import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onRequest, redirectTarget } from '../functions/_middleware.js';

const req = (url, { method = 'GET', mode } = {}) => new Request(url, {
    method,
    headers: mode ? { 'sec-fetch-mode': mode } : {},
});

test('page loads on the old address go to the same path on the new domain', () => {
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/', { mode: 'navigate' })), 'https://howsthebite.io/');
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/?section=forecast', { mode: 'navigate' })),
        'https://howsthebite.io/?section=forecast');
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/index.html', { mode: 'navigate' })),
        'https://howsthebite.io/index.html');
});

test('crawlers, which send no fetch-mode header, are redirected too', () => {
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/')), 'https://howsthebite.io/');
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/', { method: 'HEAD' })), 'https://howsthebite.io/');
});

test('files the app or its service worker fetch are not redirected', () => {
    // The service worker precaches './' with fetch(), and the page loads scripts and data.
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/', { mode: 'cors' })), null);
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/sw.js')), null);
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/js/app.js', { mode: 'cors' })), null);
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/api/usgs/collections', { mode: 'navigate' })), null);
    assert.equal(redirectTarget(req('https://howsthebite.pages.dev/', { method: 'POST' })), null);
});

test('the new domain, deployment previews and local development are left alone', () => {
    for (const url of ['https://howsthebite.io/', 'https://f7fa5fcd.howsthebite.pages.dev/', 'http://localhost:8788/']) {
        assert.equal(redirectTarget(req(url, { mode: 'navigate' })), null, url);
    }
});

test('the redirect is permanent; everything else passes through', async () => {
    const moved = await onRequest({ request: req('https://howsthebite.pages.dev/'), next: () => assert.fail('should not pass through') });
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get('location'), 'https://howsthebite.io/');

    const passed = await onRequest({ request: req('https://howsthebite.io/'), next: () => new Response('page') });
    assert.equal(await passed.text(), 'page');
});
