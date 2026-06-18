/**
 * app-banner.js — Android-only nudge to install the Play Store app.
 *
 * Shows a small dismissible bottom banner when the visitor is on an Android
 * browser, linking to the PennyHelm Android app. Deliberately skipped on:
 *   - self-host and localhost (never push the cloud app to self-hosters)
 *   - non-Android browsers
 *   - installed PWA / standalone display mode
 *   - visitors who already dismissed it (remembered in localStorage)
 *
 * Plain script, no build step, to match the rest of the static site.
 */
(function () {
    var PLAY_URL = "https://play.google.com/store/apps/details?id=com.pennyhelm.mobile";
    var DISMISS_KEY = "pennyhelm-app-banner-dismissed";

    function shouldSkip() {
        try {
            var host = location.hostname || "";
            if (host.indexOf("pennyhelm.com") === -1) return true; // self-host / localhost
            if (!/Android/i.test(navigator.userAgent || "")) return true; // Android only
            if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
            if (localStorage.getItem(DISMISS_KEY) === "1") return true; // dismissed before
        } catch (_) {
            return true;
        }
        return false;
    }

    if (shouldSkip()) return;

    function build() {
        if (document.querySelector(".app-install-banner")) return;
        var bar = document.createElement("div");
        bar.className = "app-install-banner";
        bar.setAttribute("role", "dialog");
        bar.setAttribute("aria-label", "Get the PennyHelm Android app");
        bar.innerHTML =
            '<img class="app-install-icon" src="/favicon-192x192.png" alt="" width="40" height="40">' +
            '<div class="app-install-text">' +
                "<strong>PennyHelm for Android</strong>" +
                "<span>Faster, with bill reminders on your phone</span>" +
            "</div>" +
            '<a class="app-install-cta" href="' + PLAY_URL + '" target="_blank" rel="noopener">Get the app</a>' +
            '<button class="app-install-close" type="button" aria-label="Dismiss">&times;</button>';

        bar.querySelector(".app-install-close").addEventListener("click", function () {
            try { localStorage.setItem(DISMISS_KEY, "1"); } catch (_) {}
            bar.remove();
        });

        document.body.appendChild(bar);
    }

    if (document.body) build();
    else document.addEventListener("DOMContentLoaded", build);
})();
