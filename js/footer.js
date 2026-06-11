/**
 * footer.js — Single source of truth for the site footer.
 *
 * Every public marketing/legal page (index, privacy, terms, ...) includes:
 *     <div id="site-footer"></div>
 *     <script src="/js/footer.js" defer></script>
 * and this script renders the footer into that placeholder. Change the footer
 * here once and it updates everywhere, instead of editing each page.
 *
 * Plain script (no module/build step) to match the rest of the static site.
 */
(function () {
    var GITHUB_URL = "https://github.com/administrativetrick/pennyhelm";
    var FACEBOOK_URL = "https://www.facebook.com/profile.php?id=61588465287405";
    var LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";
    var YEAR = 2026; // copyright year (project's first release year)

    var GITHUB_ICON =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">' +
        '<path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.57 ' +
        '0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.37-1.34-1.74-1.34-1.74-1.09-.73.08-.72.08-.72 ' +
        '1.2.08 1.84 1.21 1.84 1.21 1.07 1.79 2.81 1.27 3.5.97.11-.76.42-1.27.76-1.56-2.67-.3-5.47-1.31-5.47-5.83 ' +
        '0-1.29.47-2.34 1.24-3.17-.12-.3-.54-1.52.12-3.16 0 0 1.01-.32 3.3 1.21.96-.26 1.98-.39 3-.4 1.02 0 ' +
        '2.04.14 3 .4 2.29-1.53 3.3-1.21 3.3-1.21.66 1.64.24 2.86.12 3.16.77.83 1.24 1.88 1.24 3.17 0 ' +
        '4.53-2.81 5.52-5.49 5.81.43.36.81 1.09.81 2.2 0 1.59-.01 2.87-.01 3.26 0 .32.22.69.83.57C20.56 ' +
        '21.88 24 17.49 24 12.29 24 5.78 18.63.5 12 .5z"/></svg>';

    var FACEBOOK_ICON =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">' +
        '<path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6.03 4.39 11.03 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 ' +
        '1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 ' +
        '3.49h-2.8v8.44C19.61 23.1 24 18.1 24 12.07z"/></svg>';

    var html =
        '<footer class="landing-footer">' +
            '<div class="footer-inner">' +
                '<div class="footer-brand">' +
                    '<div class="logo-mark">PH</div>' +
                    '<span>PennyHelm</span>' +
                '</div>' +
                '<div class="footer-links">' +
                    '<a href="/privacy.html">Privacy</a>' +
                    '<a href="/terms.html">Terms</a>' +
                    '<a class="footer-social" href="' + GITHUB_URL + '" target="_blank" rel="noopener" aria-label="PennyHelm on GitHub">' + GITHUB_ICON + '</a>' +
                    '<a class="footer-social" href="' + FACEBOOK_URL + '" target="_blank" rel="noopener" aria-label="PennyHelm on Facebook">' + FACEBOOK_ICON + '</a>' +
                '</div>' +
                '<div class="footer-copy">&copy; ' + YEAR + ' PennyHelm &middot; Open source under <a href="' + LICENSE_URL + '" target="_blank" rel="noopener">AGPLv3</a></div>' +
            '</div>' +
        '</footer>';

    var mount = document.getElementById("site-footer");
    if (mount) {
        mount.outerHTML = html;
    }
})();
