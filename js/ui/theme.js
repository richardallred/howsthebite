// Light/dark theme. The initial theme is applied by a tiny inline script in
// index.html (before first paint); this module wires up the toggle.

import { storage } from '../storage.js';
import { $ } from './dom.js';

const THEME_COLORS = { light: '#1d4ed8', dark: '#0f172a' };
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

const currentTheme = () => storage.getTheme() ?? (systemDark.matches ? 'dark' : 'light');

function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);

    const button = $('themeToggle');
    if (button) {
        const next = theme === 'dark' ? 'light' : 'dark';
        button.setAttribute('aria-label', `Switch to ${next} theme`);
        button.title = `Switch to ${next} theme`;
        button.querySelector('use')?.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
    }
}

export function initTheme() {
    apply(currentTheme());

    $('themeToggle')?.addEventListener('click', () => {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        storage.setTheme(next);
        apply(next);
    });

    // Follow the system setting until the user picks a theme explicitly.
    systemDark.addEventListener('change', () => {
        if (!storage.getTheme()) apply(currentTheme());
    });
}
