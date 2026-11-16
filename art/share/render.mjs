// Renders the link-preview cards from art/share/share-card.html at 1200 × 630:
//   screenshots/share-card.png   the generic card (the home page, and places without their own)
//   og/<slug>.png                one per place on the popular spots page, with its name
// Needs the dev server (npm start): Chrome will not load the drawings, used as CSS masks, from file://.
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = new URL('../../', import.meta.url);
const base = `http://localhost:${process.env.PORT ?? 8000}/art/share/share-card.html`;
const html = await readFile(new URL('spots/index.html', root), 'utf8');
const places = [...html.matchAll(/<a href="\/fishing\/[^/"]+\/([^"/?]+)"[^>]*>([^<]+)<\/a>/g)].map(([, slug, name]) => ({ slug, name }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
async function render(url, path) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: fileURLToPath(new URL(path, root)), type: path.endsWith('.jpg') ? 'jpeg' : 'png', quality: path.endsWith('.jpg') ? 80 : undefined });
}
await render(base, 'screenshots/share-card.png');
await mkdir(new URL('og/', root), { recursive: true });
for (const { slug, name } of places) await render(`${base}?place=${encodeURIComponent(name)}`, `og/${slug}.jpg`);
console.log(`Rendered the generic card and ${places.length} place cards`);
await browser.close();
