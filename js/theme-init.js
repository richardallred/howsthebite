// Runs before first paint: loaded as a blocking classic script from <head>, and kept in
// its own file so the Content-Security-Policy needs no inline scripts.
(function () {
    var root = document.documentElement;
    var storage = null;
    try { storage = window.localStorage; } catch (e) { /* storage unavailable */ }
    var read = function (key) {
        try { return JSON.parse(storage.getItem(key)); } catch (e) { return null; }
    };

    // The saved (or system) theme, so the page never flashes the wrong colours.
    var theme = read('htb:theme');
    if (theme !== 'light' && theme !== 'dark') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    root.dataset.theme = theme;

    // A first visit (no saved place, and no place in the address) opens on the default city
    // with a notice saying so. Marking it here lets the notice be in the first paint rather
    // than push the page down when the app starts; js/app.js takes over from this mark.
    if (!read('htb:location') && window.location.pathname.indexOf('/fishing/') !== 0) {
        root.dataset.firstVisit = '';
    }
})();
