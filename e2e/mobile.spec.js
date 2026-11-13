import { expect, test } from './support/fixtures.js';

// Runs in the "mobile" project (Pixel 7 viewport, touch).

test('fits a phone screen without horizontal scrolling', async ({ page, app }) => {
    await app.open();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);

    // The location button collapses to an icon but keeps its accessible name.
    await expect(page.locator('#locateBtn span')).toBeHidden();
    await expect(page.locator('#scoreValue')).toHaveText('100');
    await expect(page.locator('.factor')).toHaveCount(6);
});

test('bottom navigation jumps between sections and tracks the visible one', async ({ page, app }) => {
    await app.open();
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Conditions' })).toHaveAttribute('aria-current', 'true');

    await nav.getByRole('link', { name: 'Water' }).click();
    await expect(page.getByRole('heading', { name: 'Water temperature, level and flow' })).toBeInViewport();
    await expect(nav.getByRole('link', { name: 'Water' })).toHaveAttribute('aria-current', 'true');
    await expect(nav.getByRole('link', { name: 'Conditions' })).not.toHaveAttribute('aria-current', 'true');

    await nav.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('heading', { name: 'Last 48 hours' })).toBeInViewport();
});

test('deep links from the installed app shortcuts land on their section', async ({ page, app }) => {
    await app.open('/#forecast');
    await expect(page.getByRole('heading', { name: '5-day forecast' })).toBeInViewport();
});

test('stations can be chosen by touch and the chart responds to a tap', async ({ page, app }) => {
    await app.open();
    await app.station('Clear Lake').tap();
    await expect(app.station('Clear Lake')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.factor('Water temperature').locator('.factor-value')).toHaveText('71.6°F');

    const plot = page.locator('#pressureChart .chart-plot');
    await plot.scrollIntoViewIfNeeded();
    await plot.tap();
    await expect(page.locator('#pressureChart .chart-tooltip')).toBeVisible();
});
