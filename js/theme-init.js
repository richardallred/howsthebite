// Applies the saved (or system) theme before first paint, so the page never
// flashes the wrong colours. Loaded as a blocking classic script from <head>;
// kept in its own file so the Content-Security-Policy needs no inline scripts.
(function () {
    var theme = null;
    try { theme = JSON.parse(localStorage.getItem('htb:theme')); } catch (e) { /* storage unavailable */ }
    if (theme !== 'light' && theme !== 'dark') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = theme;
})();
