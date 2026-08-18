/* ============================================================================
 * TradingSocial — consent gate + tag loader (marketing site)
 * Audit item 17, findings 5, 6, 7 and 10. Workstream 7.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Every marketing page used to carry three inline <script> blocks in <head>
 * that loaded gtag.js, Reddit's pixel.js and Meta's fbevents.js unconditionally
 * on first paint, plus a <noscript> Meta beacon in <body>. Nothing could be
 * declined. Those blocks are gone; this file is the single place that decides
 * whether any of them load at all.
 *
 * THE LEGAL POSITION THIS IS BUILT AGAINST — read before changing the defaults
 * ---------------------------------------------------------------------------
 * Australia has NO equivalent of the EU ePrivacy Directive. There is no
 * standalone rule that a cookie needs consent before it is set. The Privacy Act
 * 1988 (Cth) engages only where the data is *personal information*, so the
 * three tiers below carry genuinely different risk and are graded differently
 * on purpose:
 *
 *   essential   Nothing here. There are no session or functional cookies on the
 *               marketing site at all -- it is static HTML.
 *
 *   analytics   GA4. A pseudonymous client id, IP truncated by Google server
 *               side, used for aggregate site measurement. The obligation this
 *               engages is APP 1.4 *disclosure*, which section 10 of
 *               /privacy now satisfies. DEFAULT: ON (opt-out).
 *
 *   ads         Meta Pixel + Reddit Pixel. These transmit persistent
 *               identifiers (_fbp, _rdt_uuid, _rdt_em) to advertising networks
 *               for audience building and cross-site linkage, and Meta's
 *               beacon carries the visitor's own Meta cookies where third-party
 *               cookies are allowed. That is disclosure of personal information
 *               to a third party for a secondary purpose -- APP 6 territory.
 *               DEFAULT: OFF (opt-in).
 *
 * ADS_DEFAULT is the switch the business owner may want to argue with, so it is
 * a named constant rather than something buried in a branch. Setting it to true
 * restores the pre-audit behaviour (advertising pixels on by default, still
 * declinable) and remains lawful in Australia. It was set to false because the
 * audit graded the pixel transfers well above the analytics, and because it is
 * the only setting under which the Reddit Conversions API transfer -- which no
 * browser control can reach -- becomes something a visitor can actually stop.
 * The cost is reduced Meta/Reddit attribution for visitors who ignore the
 * notice. That is a business trade, not a technical one.
 *
 * If the business ever targets the EU or the UK, ANALYTICS_DEFAULT must also
 * become false: under ePrivacy/PECR prior consent is mandatory and none of
 * these cookies is essential. That is a one-line change here plus the same
 * change in app/src/lib/consent.ts.
 *
 * CACHING: served with Cache-Control: no-cache via vercel.json. Do NOT move
 * this file under /assets/ -- that path is immutable for a year, which is not
 * an acceptable staleness window for a privacy control.
 * ==========================================================================*/
(function (w, d) {
  'use strict';

  var COOKIE = 'ts_consent';
  var VERSION = 1;
  var MAX_AGE = 60 * 60 * 24 * 180; // 180 days, then we ask again

  var ANALYTICS_DEFAULT = true;
  var ADS_DEFAULT = false;

  var GA_ID = 'G-M7NX0Y7NSC';
  var META_ID = '1056839790113606';
  var REDDIT_ID = 'a2_jbawbd7fkiwo';

  var PRIVACY_URL = '/privacy';

  // ---------------------------------------------------------------- cookie io

  function readCookie() {
    var m = d.cookie.match(/(?:^|;\s*)ts_consent=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function parse(raw) {
    if (!raw) return null;
    var o = {};
    raw.split('|').forEach(function (pair) {
      var kv = pair.split(':');
      o[kv[0]] = kv[1];
    });
    // A version bump invalidates stored choices, which is the correct behaviour
    // when the tier definitions change -- we re-ask rather than assume.
    if (String(o.v) !== String(VERSION)) return null;
    // Both tier keys must be present. A truncated value like "v:1" would
    // otherwise read as "declined everything, and already decided" -- safe for
    // tracking, but it would permanently suppress the notice, so the visitor
    // could never turn anything back on because they would never be asked.
    if (o.a == null || o.d == null) return null;
    return { analytics: o.a === '1', ads: o.d === '1', decided: true };
  }

  function cookieDomain() {
    // Shared across www.tradingsocial.io and app.tradingsocial.io so the
    // visitor answers once. On localhost / previews, host-only.
    return /(^|\.)tradingsocial\.io$/.test(location.hostname) ? '; domain=.tradingsocial.io' : '';
  }

  function writeCookie(analytics, ads) {
    var val = 'v:' + VERSION + '|a:' + (analytics ? 1 : 0) + '|d:' + (ads ? 1 : 0);
    d.cookie =
      COOKIE + '=' + val +
      '; path=/; max-age=' + MAX_AGE + '; samesite=lax' +
      (location.protocol === 'https:' ? '; secure' : '') +
      cookieDomain();
  }

  var stored = parse(readCookie());
  var state = stored || { analytics: ANALYTICS_DEFAULT, ads: ADS_DEFAULT, decided: false };

  // ------------------------------------------------------- revocation cleanup

  // Tags cannot be unloaded once a page has them, and a cookie that survives a
  // "decline" makes the control theatre. So revoking purges what the revoked
  // tier wrote and reloads. Names come from the live inventory in item 17.
  var TRACKER_COOKIES = {
    analytics: [/^_ga$/, /^_ga_/, /^_gid$/, /^_gat/],
    ads: [/^_fbp$/, /^_fbc$/, /^_rdt_uuid$/, /^_rdt_em$/, /^rdt_cid$/]
  };

  function purge(tier) {
    var pats = TRACKER_COOKIES[tier] || [];
    var names = d.cookie.split(';').map(function (c) { return c.split('=')[0].trim(); });
    names.forEach(function (name) {
      var hit = pats.some(function (p) { return p.test(name); });
      if (!hit) return;
      // Delete on the host and on the registrable domain -- gtag writes to the
      // latter, so clearing only the host leaves the id alive.
      d.cookie = name + '=; path=/; max-age=0';
      d.cookie = name + '=; path=/; max-age=0' + cookieDomain();
    });
    if (tier === 'analytics') {
      try { localStorage.removeItem('ts_anon_id'); localStorage.removeItem('ts_anon_id_exp'); } catch (e) {}
    }
  }

  // ------------------------------------------------------------- tag loaders

  var loaded = { ga: false, meta: false, reddit: false };

  function consentSignal(s) {
    return {
      ad_storage: s.ads ? 'granted' : 'denied',
      ad_user_data: s.ads ? 'granted' : 'denied',
      ad_personalization: s.ads ? 'granted' : 'denied',
      analytics_storage: s.analytics ? 'granted' : 'denied'
    };
  }

  function loadGA() {
    if (loaded.ga) return;
    loaded.ga = true;

    w.dataLayer = w.dataLayer || [];
    if (!w.gtag) w.gtag = function () { w.dataLayer.push(arguments); };

    // Google Consent Mode v2 (finding 5). This MUST be pushed before gtag.js is
    // requested, which is why the loader lives below it. ad_personalization
    // denied is what turns off npa=0 / Google Signals personalisation.
    w.gtag('consent', 'default', consentSignal(state));
    w.gtag('js', new Date());
    if (internalTraffic) w.gtag('set', 'traffic_type', 'internal');
    w.gtag('config', GA_ID, {
      linker: { domains: ['tradingsocial.io', 'app.tradingsocial.io'] },
      // Finding 7: gtag writes _ga/_ga_* without Secure unless told otherwise.
      cookie_flags: 'SameSite=Lax;Secure',
      // Finding 10: 13 months, a deliberate business retention decision rather
      // than GA's 2-year request silently clamped to 400 days by Chrome.
      cookie_expires: 34128000
    });

    var s = d.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    d.head.appendChild(s);
  }

  function loadMeta() {
    if (loaded.meta) return;
    loaded.meta = true;
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s)
    }(w, d, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    // Limited Data Use (finding 5). (0,0) asks Meta to geolocate the visitor and
    // apply LDU wherever a state privacy law requires it, rather than us trying
    // to enumerate US states. Must precede init.
    w.fbq('dataProcessingOptions', ['LDU'], 0, 0);
    w.fbq('init', META_ID);
    w.fbq('track', 'PageView');
  }

  function loadReddit() {
    if (loaded.reddit) return;
    loaded.reddit = true;
    /* eslint-disable */
    !function (ww, dd) {
      if (!ww.rdt) {
        var p = ww.rdt = function () { p.sendEvent ? p.sendEvent.apply(p, arguments) : p.callQueue.push(arguments) };
        p.callQueue = [];
        var t = dd.createElement('script'); t.src = 'https://www.redditstatic.com/ads/pixel.js?pixel_id=' + REDDIT_ID; t.async = !0;
        var s = dd.getElementsByTagName('script')[0]; s.parentNode.insertBefore(t, s);
      }
    }(w, d);
    /* eslint-enable */
    w.rdt('init', REDDIT_ID);
    w.rdt('track', 'PageVisit');
  }

  function apply() {
    if (state.analytics) loadGA();
    if (state.ads) { loadMeta(); loadReddit(); }
    // Late grant/revoke within the same page view.
    if (loaded.ga && w.gtag) w.gtag('consent', 'update', consentSignal(state));
  }

  // Internal-traffic exclusion is a staff control, not tracking, and must work
  // regardless of the consent answer -- otherwise declining analytics would also
  // stop us from being able to mark ourselves internal.
  var internalTraffic = false;
  try {
    if (new URLSearchParams(location.search).get('internal') === '1') localStorage.setItem('ts_internal', '1');
    internalTraffic = localStorage.getItem('ts_internal') === '1';
  } catch (e) {}

  // ------------------------------------------------------------------ save

  function save(analytics, ads) {
    var revoked = (state.analytics && !analytics) || (state.ads && !ads);
    writeCookie(analytics, ads);
    if (state.analytics && !analytics) purge('analytics');
    if (state.ads && !ads) purge('ads');
    state = { analytics: !!analytics, ads: !!ads, decided: true };
    close();
    if (revoked && (loaded.ga || loaded.meta || loaded.reddit)) {
      // Already-executing third-party script cannot be trusted to stop; the only
      // honest way to make a decline real is to drop the page that holds it.
      location.reload();
      return;
    }
    apply();
  }

  // ------------------------------------------------------------------- ui

  var root = null;

  var CSS =
    '#ts-consent{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;' +
    'background:var(--bg,#fff);color:var(--text,#16131F);' +
    'border-top:1px solid var(--border-2,rgba(22,19,40,.14));' +
    'box-shadow:0 -10px 34px -12px rgba(22,19,40,.28);font-size:13.5px;line-height:1.6}' +
    '#ts-consent .ts-c-in{max-width:1100px;margin:0 auto;padding:15px 20px;' +
    'display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}' +
    '#ts-consent p{margin:0;flex:1 1 380px;color:var(--dim,#56536B)}' +
    '#ts-consent p strong{color:var(--text,#16131F)}' +
    '#ts-consent a{color:var(--violet-br,#6B43E0);text-decoration:underline}' +
    '#ts-consent .ts-c-act{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '#ts-consent button{font:inherit;cursor:pointer;border-radius:10px;padding:9px 14px;' +
    'border:1px solid var(--border-2,rgba(22,19,40,.14));background:var(--surface,#fff);' +
    'color:var(--text,#16131F);font-weight:600}' +
    '#ts-consent button:hover{border-color:var(--border-vio,rgba(124,92,230,.32))}' +
    '#ts-consent button.ts-c-primary{background:var(--violet-br,#6B43E0);border-color:transparent;' +
    'color:#fff}' +
    '#ts-consent button:focus-visible{outline:2px solid var(--violet,#7C5CE6);outline-offset:2px}' +
    '#ts-consent .ts-c-prefs{flex:1 1 100%;margin-top:4px;display:none}' +
    '#ts-consent .ts-c-prefs.open{display:block}' +
    '#ts-consent .ts-c-row{display:flex;gap:10px;align-items:flex-start;padding:10px 0;' +
    'border-top:1px solid var(--border,rgba(22,19,40,.09))}' +
    '#ts-consent .ts-c-row label{font-weight:700}' +
    '#ts-consent .ts-c-row small{display:block;font-weight:400;color:var(--dim,#56536B);margin-top:2px}' +
    '@media (max-width:640px){#ts-consent .ts-c-act{width:100%}' +
    '#ts-consent .ts-c-act button{flex:1 1 auto}}';

  function injectCss() {
    if (d.getElementById('ts-consent-css')) return;
    var st = d.createElement('style');
    st.id = 'ts-consent-css';
    st.textContent = CSS;
    d.head.appendChild(st);
  }

  function close() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }

  function render(showPrefs) {
    close();
    injectCss();
    root = d.createElement('div');
    root.id = 'ts-consent';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-label', 'Cookies and tracking');
    root.innerHTML =
      '<div class="ts-c-in">' +
        '<p><strong style="display:block;color:var(--text,#eef1f8);margin-bottom:2px">Cookies and tracking</strong>' +
        'We use analytics cookies to see how the site is used. Advertising pixels from Meta and Reddit ' +
        'are <strong>off unless you turn them on</strong>. Full detail, including what our servers send ' +
        'Reddit, is in our <a href="' + PRIVACY_URL + '#cookies">privacy policy</a>.</p>' +
        '<div class="ts-c-act">' +
          '<button type="button" data-ts="manage">Manage</button>' +
          '<button type="button" data-ts="reject">Reject non-essential</button>' +
          '<button type="button" class="ts-c-primary" data-ts="accept">Accept all</button>' +
        '</div>' +
        '<div class="ts-c-prefs' + (showPrefs ? ' open' : '') + '">' +
          '<div class="ts-c-row"><input type="checkbox" id="ts-c-analytics"' + (state.analytics ? ' checked' : '') + '>' +
            '<label for="ts-c-analytics">Analytics<small>Google Analytics. Aggregate measurement of how pages are used. Cookies last 13 months.</small></label></div>' +
          '<div class="ts-c-row"><input type="checkbox" id="ts-c-ads"' + (state.ads ? ' checked' : '') + '>' +
            '<label for="ts-c-ads">Advertising<small>Meta and Reddit pixels. These send persistent identifiers to advertising networks and let them link this visit to your account with them. Leaving this off also stops our servers sending Reddit a signup or purchase event.</small></label></div>' +
          '<div class="ts-c-row" style="border:0"><button type="button" class="ts-c-primary" data-ts="save">Save choices</button></div>' +
        '</div>' +
      '</div>';

    root.addEventListener('click', function (ev) {
      var act = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-ts');
      if (!act) return;
      if (act === 'accept') return save(true, true);
      if (act === 'reject') return save(false, false);
      if (act === 'manage') {
        var panel = root.querySelector('.ts-c-prefs');
        if (panel) panel.classList.toggle('open');
        return;
      }
      if (act === 'save') {
        return save(
          !!root.querySelector('#ts-c-analytics').checked,
          !!root.querySelector('#ts-c-ads').checked
        );
      }
    });

    (d.body || d.documentElement).appendChild(root);
  }

  // A permanent way back in, so a choice is changeable and not a one-shot.
  function addFooterLink() {
    if (d.getElementById('ts-consent-link')) return;
    var privacy = d.querySelector('footer a[href="/privacy"], footer a[href$="/privacy"]');
    if (!privacy || !privacy.parentNode) return;
    var a = d.createElement('a');
    a.id = 'ts-consent-link';
    a.href = '#';
    a.textContent = 'Cookie settings';
    a.addEventListener('click', function (e) { e.preventDefault(); render(true); });
    privacy.parentNode.insertBefore(a, privacy.nextSibling);
  }

  function ready(fn) {
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // Public surface: used by the footer link and by anything that needs to know
  // the answer (e.g. deciding whether to fire a first-party event).
  w.TSConsent = {
    state: function () { return { analytics: state.analytics, ads: state.ads, decided: state.decided }; },
    open: function () { render(true); },
    save: save,
    // For per-page analytics events (404 diagnostics). No-ops when the visitor
    // declined analytics, which is the point -- the caller does not have to
    // know the consent state.
    gaEvent: function (name, params) { if (loaded.ga && w.gtag) w.gtag('event', name, params); }
  };

  apply();
  ready(function () {
    addFooterLink();
    if (!state.decided) render(false);
  });
})(window, document);
