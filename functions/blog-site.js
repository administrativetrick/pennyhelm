/**
 * Public blog — server-rendered pages for the `posts` collection.
 *
 * Served via Firebase Hosting rewrites:
 *   /blog          → index: lists every published post
 *   /blog/<slug>   → article: renders one published post
 *
 * Server-rendering (vs. a client-side static page) gives crawlable HTML with
 * correct per-article <title>/meta/Open-Graph tags and JSON-LD — which is the
 * whole point of a public blog. Only `status === 'publish'` posts are ever
 * shown; drafts/rejected return 404. Reads via the Admin SDK.
 *
 * This file is presentation only — it contains no private logic, so it lives in
 * the public repo. The article bodies live in Firestore.
 *
 * @module blog-site
 */

const { onRequest } = require("firebase-functions/v2/https");

const SITE = "https://pennyhelm.com";
const DEFAULT_OG = `${SITE}/og-image.png`;
const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

module.exports = ({ db }) => {

    // ─── Small helpers ─────────────────────────────────────────

    function escapeHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function tsToMs(ts) {
        if (ts && typeof ts.toDate === "function") return ts.toDate().getTime();
        if (ts) { const t = new Date(ts).getTime(); return isNaN(t) ? 0 : t; }
        return 0;
    }

    function formatDate(ts) {
        const ms = tsToMs(ts);
        if (!ms) return "";
        const d = new Date(ms);
        return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    }

    // ─── Markdown → HTML (safe subset) ─────────────────────────
    // The whole string is HTML-escaped FIRST, so no raw HTML in the markdown can
    // ever execute — this is XSS-safe by construction even though the content is
    // our own. Then a small block/inline transformer handles the subset Gemini
    // emits: headings, lists, bold/italic, links, inline code, code fences, hr.

    function inline(text) {
        let t = text;
        // inline code
        t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
        // links [label](url) — only http(s) or root-relative; external gets rel.
        t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
            const clean = url.trim();
            if (!/^(https?:\/\/|\/)/i.test(clean)) return label;
            const external = /^https?:/i.test(clean);
            return `<a href="${clean}"${external ? ' target="_blank" rel="noopener nofollow"' : ""}>${label}</a>`;
        });
        // bold then italic
        t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
        t = t.replace(/_([^_\n]+)_/g, "<em>$1</em>");
        return t;
    }

    function renderMarkdown(md) {
        const lines = escapeHtml(md).split(/\r?\n/);
        const out = [];
        let para = [];
        let listType = null;
        let listItems = [];

        const flushPara = () => {
            if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
        };
        const flushList = () => {
            if (listItems.length) {
                out.push(`<${listType}>${listItems.map((li) => `<li>${inline(li)}</li>`).join("")}</${listType}>`);
                listItems = []; listType = null;
            }
        };

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const t = raw.trim();

            // fenced code block
            if (t.startsWith("```")) {
                flushPara(); flushList();
                const buf = [];
                i++;
                while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
                out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
                continue;
            }
            if (t === "") { flushPara(); flushList(); continue; }
            if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushPara(); flushList(); out.push("<hr>"); continue; }
            if (/^###\s+/.test(t)) { flushPara(); flushList(); out.push(`<h3>${inline(t.replace(/^###\s+/, ""))}</h3>`); continue; }
            if (/^##\s+/.test(t)) { flushPara(); flushList(); out.push(`<h2>${inline(t.replace(/^##\s+/, ""))}</h2>`); continue; }
            if (/^#\s+/.test(t)) { flushPara(); flushList(); out.push(`<h1>${inline(t.replace(/^#\s+/, ""))}</h1>`); continue; }
            if (/^[-*]\s+/.test(t)) {
                flushPara();
                if (listType && listType !== "ul") flushList();
                listType = "ul"; listItems.push(t.replace(/^[-*]\s+/, "")); continue;
            }
            if (/^\d+\.\s+/.test(t)) {
                flushPara();
                if (listType && listType !== "ol") flushList();
                listType = "ol"; listItems.push(t.replace(/^\d+\.\s+/, "")); continue;
            }
            if (listType) flushList();
            para.push(t);
        }
        flushPara(); flushList();
        return out.join("\n");
    }

    // ─── Page shell ────────────────────────────────────────────

    const BLOG_CSS = `
        /* top padding clears the 64px position:fixed .landing-nav */
        .blog-wrap{max-width:780px;margin:0 auto;padding:96px 20px 80px;}
        .blog-wrap h1{font-size:2rem;font-weight:700;color:#e8eaed;margin:0 0 8px;line-height:1.25;}
        .blog-wrap h2{font-size:1.35rem;font-weight:700;color:#e8eaed;margin:34px 0 12px;}
        .blog-wrap h3{font-size:1.08rem;font-weight:600;color:#c0c4d0;margin:24px 0 8px;}
        .blog-wrap p,.blog-wrap li{color:#9aa0b0;font-size:1rem;line-height:1.75;margin-bottom:14px;}
        .blog-wrap ul,.blog-wrap ol{padding-left:24px;margin-bottom:16px;}
        .blog-wrap li{margin-bottom:6px;}
        .blog-wrap a{color:#4f8cff;text-decoration:none;}
        .blog-wrap a:hover{text-decoration:underline;}
        .blog-wrap strong{color:#c0c4d0;}
        .blog-wrap code{background:#1a1d27;padding:2px 6px;border-radius:4px;font-size:0.9em;color:#c0c4d0;}
        .blog-wrap pre{background:#13151d;border:1px solid #2e3348;border-radius:8px;padding:14px;overflow:auto;margin-bottom:16px;}
        .blog-wrap pre code{background:none;padding:0;}
        .blog-wrap hr{border:none;border-top:1px solid #2e3348;margin:28px 0;}
        .blog-date{color:#6b7185;font-size:0.9rem;margin-bottom:28px;}
        .back-link{display:inline-block;margin-bottom:24px;color:#4f8cff;text-decoration:none;font-size:0.95rem;}
        .back-link:hover{text-decoration:underline;}
        .blog-hero{width:100%;border-radius:10px;margin:0 0 28px;border:1px solid #2e3348;}
        .blog-list{list-style:none;padding:0;margin:0;}
        .blog-list-item{padding:22px 0;border-bottom:1px solid #2e3348;}
        .blog-list-item:last-child{border-bottom:none;}
        .blog-list-item h2{margin:0 0 6px;font-size:1.25rem;}
        .blog-list-item h2 a{color:#e8eaed;}
        .blog-list-item p{margin:0 0 6px;}
        .blog-lead{color:#9aa0b0;font-size:1rem;margin-bottom:32px;}
        .blog-footer{max-width:780px;margin:0 auto;padding:24px 20px 60px;border-top:1px solid #2e3348;color:#6b7185;font-size:0.85rem;display:flex;gap:16px;flex-wrap:wrap;}
        .blog-footer a{color:#9aa0b0;text-decoration:none;}
        .blog-footer a:hover{text-decoration:underline;}
    `;

    // Optional page extras present only in private builds; absent in the
    // open-source repo, in which case this returns "".
    function blogExtras(ctx) {
        try { return require("./blog-extras").bannerHtml(ctx || {}); } catch { return ""; }
    }

    function layout({ title, description, canonical, ogImage, ogType, jsonLd, body, slug }) {
        const desc = escapeHtml(description || "Personal finance tips and guides from PennyHelm.");
        const img = escapeHtml(ogImage || DEFAULT_OG);
        const url = escapeHtml(canonical);
        const t = escapeHtml(title);
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${escapeHtml(ogType || "website")}">
<meta property="og:site_name" content="PennyHelm">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<script>(function(){var t=localStorage.getItem('pennyhelm-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');else if(t==='dark')document.documentElement.setAttribute('data-theme','dark');})()</script>
<link rel="stylesheet" href="/css/landing.css">
<style>${BLOG_CSS}</style>
${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ""}
</head>
<body>
<nav class="landing-nav">
  <div class="landing-nav-inner">
    <div class="landing-logo">
      <a href="/" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
        <div class="logo-mark">PH</div>
        <span class="logo-text">PennyHelm</span>
      </a>
    </div>
    <div class="landing-nav-links">
      <a href="/blog">Blog</a>
      <a href="/">Home</a>
      <a href="/login.html" class="nav-cta">Sign In</a>
    </div>
  </div>
</nav>
${body}
${blogExtras({ slug })}
<footer class="blog-footer">
  <span>&copy; ${new Date().getUTCFullYear()} PennyHelm</span>
  <a href="/">Home</a>
  <a href="/blog">Blog</a>
  <a href="/privacy.html">Privacy</a>
  <a href="/terms.html">Terms</a>
</footer>
</body>
</html>`;
    }

    // ─── Index + article + error pages ─────────────────────────

    function renderIndex(posts) {
        const items = posts.length
            ? `<ul class="blog-list">${posts.map((p) => `
                <li class="blog-list-item">
                    <h2><a href="/blog/${escapeHtml(p.slug)}">${escapeHtml(p.title || "(untitled)")}</a></h2>
                    ${p.metaDescription ? `<p>${escapeHtml(p.metaDescription)}</p>` : ""}
                    ${p.createdAt ? `<div class="blog-date">${escapeHtml(formatDate(p.createdAt))}</div>` : ""}
                </li>`).join("")}</ul>`
            : `<p class="blog-lead">No posts yet — check back soon.</p>`;

        return layout({
            title: "Blog — PennyHelm",
            description: "Personal finance tips, budgeting guides, and money-management advice from PennyHelm.",
            canonical: `${SITE}/blog`,
            ogType: "website",
            body: `<main class="blog-wrap">
                <h1>PennyHelm Blog</h1>
                <p class="blog-lead">Practical, no-nonsense guides on budgeting, bills, debt, and tracking your money.</p>
                ${items}
            </main>`,
        });
    }

    function renderArticle(post) {
        // Strip a leading "# Title" from the body so we don't render two H1s —
        // we render post.title as the page H1 with a date beneath it.
        let md = String(post.contentMarkdown || "");
        md = md.replace(/^\s*#\s+.*(\r?\n)+/, "");

        const dateStr = formatDate(post.createdAt);
        const canonical = `${SITE}/blog/${post.slug}`;
        const ogImage = post.heroImageUrl && /^https?:\/\//i.test(post.heroImageUrl) ? post.heroImageUrl : DEFAULT_OG;

        const jsonLd = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": post.title || "",
            "description": post.metaDescription || "",
            "datePublished": tsToMs(post.createdAt) ? new Date(tsToMs(post.createdAt)).toISOString() : undefined,
            "dateModified": tsToMs(post.updatedAt) ? new Date(tsToMs(post.updatedAt)).toISOString() : undefined,
            "author": { "@type": "Organization", "name": "PennyHelm" },
            "publisher": { "@type": "Organization", "name": "PennyHelm", "logo": { "@type": "ImageObject", "url": DEFAULT_OG } },
            "mainEntityOfPage": canonical,
            "url": canonical,
        });

        const hero = post.heroImageUrl && /^https?:\/\//i.test(post.heroImageUrl)
            ? `<img class="blog-hero" src="${escapeHtml(post.heroImageUrl)}" alt="${escapeHtml(post.title || "")}" loading="eager">`
            : "";

        return layout({
            title: `${post.title || "Post"} — PennyHelm`,
            description: post.metaDescription || "",
            canonical,
            slug: post.slug,
            ogType: "article",
            ogImage,
            jsonLd,
            body: `<main class="blog-wrap">
                <a href="/blog" class="back-link">&larr; All posts</a>
                ${hero}
                <h1>${escapeHtml(post.title || "")}</h1>
                ${dateStr ? `<div class="blog-date">${escapeHtml(dateStr)}</div>` : ""}
                <article>${renderMarkdown(md)}</article>
            </main>`,
        });
    }

    function renderMessage(heading, msg) {
        return layout({
            title: `${heading} — PennyHelm`,
            description: msg,
            canonical: `${SITE}/blog`,
            body: `<main class="blog-wrap">
                <a href="/blog" class="back-link">&larr; All posts</a>
                <h1>${escapeHtml(heading)}</h1>
                <p>${escapeHtml(msg)}</p>
            </main>`,
        });
    }

    // ─── Sitemap ───────────────────────────────────────────────
    // Static marketing pages + every published blog post, so the sitemap stays
    // current automatically as posts are published.

    function renderSitemap(posts) {
        const today = new Date().toISOString().slice(0, 10);
        const staticUrls = [
            { loc: `${SITE}/`, lastmod: today },
            { loc: `${SITE}/faq`, lastmod: "2026-06-24" },
            { loc: `${SITE}/alternatives`, lastmod: "2026-06-24" },
            { loc: `${SITE}/blog`, lastmod: today },
            { loc: `${SITE}/link-to-us`, lastmod: "2026-06-24" },
            { loc: `${SITE}/switch`, lastmod: "2026-06-10" },
            { loc: `${SITE}/privacy.html`, lastmod: "2026-06-11" },
            { loc: `${SITE}/terms.html`, lastmod: "2026-06-10" },
        ];
        const postUrls = posts
            .slice()
            .sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt))
            .map((p) => {
                const ms = tsToMs(p.updatedAt) || tsToMs(p.createdAt);
                return { loc: `${SITE}/blog/${p.slug}`, lastmod: ms ? new Date(ms).toISOString().slice(0, 10) : today };
            });
        const body = staticUrls.concat(postUrls)
            .map((u) => `  <url>\n    <loc>${escapeHtml(u.loc)}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`)
            .join("\n");
        return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
    }

    // ─── blogSite — HTTP, public ───────────────────────────────

    const blogSite = onRequest({ region: "us-central1", cors: false, invoker: "public" }, async (req, res) => {
        try {
            // Hosting rewrites /blog/** here preserving the path; the direct
            // function URL would give /<slug>. Drop a leading "blog" segment so
            // both forms resolve.
            const trimmed = req.path.replace(/^\/+|\/+$/g, "");

            // Dynamic sitemap: static pages + every published post.
            if (trimmed === "sitemap.xml") {
                const snap = await db.collection("posts").where("status", "==", "publish").get();
                const posts = snap.docs.map((d) => ({ slug: d.id, ...d.data() }));
                res.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
                res.status(200).type("application/xml").send(renderSitemap(posts));
                return;
            }

            let segments = trimmed ? trimmed.split("/") : [];
            if (segments[0] === "blog") segments = segments.slice(1);
            const slug = segments[0] ? decodeURIComponent(segments[0]) : null;

            if (!slug) {
                // Index — query is provably published-only, so it satisfies the
                // public read rule.
                const snap = await db.collection("posts").where("status", "==", "publish").get();
                const posts = snap.docs
                    .map((d) => ({ slug: d.id, ...d.data() }))
                    .sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
                res.set("Cache-Control", "public, max-age=300, s-maxage=600");
                res.status(200).type("html").send(renderIndex(posts));
                return;
            }

            const doc = await db.collection("posts").doc(slug).get();
            if (!doc.exists || doc.data().status !== "publish") {
                res.set("Cache-Control", "public, max-age=60");
                res.status(404).type("html").send(renderMessage("Post not found", "That post doesn't exist or isn't published."));
                return;
            }

            res.set("Cache-Control", "public, max-age=300, s-maxage=600");
            res.status(200).type("html").send(renderArticle({ slug: doc.id, ...doc.data() }));
        } catch (err) {
            console.error("[blogSite] error:", err);
            res.status(500).type("html").send(renderMessage("Something went wrong", "Please try again later."));
        }
    });

    return { blogSite };
};
