/**
 * analytics.js — Privacy-friendly, cookieless web analytics (Umami).
 *
 * Loads ONLY on the public pennyhelm.com marketing pages. It is skipped on
 * self-host and localhost, so self-hosted installs never contact any analytics
 * service, and it is intentionally NOT included on the authenticated app pages
 * where financial data lives.
 *
 * Umami sets no cookies and collects no personal data, so no consent banner is
 * required. See privacy.html section 1.10.
 *
 * SETUP: create a website in Umami (cloud free tier at umami.is, or self-host),
 * copy its Website ID, and paste it into UMAMI_WEBSITE_ID below. Ships inert
 * until then. To self-host, also point UMAMI_SRC at your instance's script.js.
 * To swap to Plausible or another cookieless tool later, this one file is the
 * only thing that changes.
 */
(function () {
    var UMAMI_SRC = 'https://cloud.umami.is/script.js';
    var UMAMI_WEBSITE_ID = '90c8f14c-b69d-4706-b965-3b9f7cbfd110'; // Umami Cloud site for pennyhelm.com

    var host = (typeof location !== 'undefined' && location.hostname) || '';
    if (host.indexOf('pennyhelm.com') === -1) return; // self-host / localhost: never load
    if (!UMAMI_WEBSITE_ID) return; // not configured yet — stay inert

    var s = document.createElement('script');
    s.defer = true;
    s.src = UMAMI_SRC;
    s.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
    document.head.appendChild(s);
})();
