/* =========================================================
   THE LAST FRAME — Background music (shared on every page)
   - One <audio> per page, looped. Autoplay is ON by default; if the
     browser blocks sound, it starts on the visitor's first interaction.
   - Internal links use SOFT NAVIGATION (page swapped without a reload)
     so this one audio element never stops between pages.
   - State (on/off + playback position) lives in localStorage as the
     fallback: a full page load resumes where the last one stopped.
   - Audio path is resolved from THIS script's URL, so it works on
     GitHub Pages project sub-paths (/repo-name/...) too.
   ========================================================= */
(function () {
  'use strict';

  // Guard: never create a second player if the script is loaded twice.
  if (window.__tlfMusic) return;
  window.__tlfMusic = true;

  /* ---------- Config ---------- */
  var STORAGE_KEY = 'tlf-music';
  var VOLUME = 0.55;               // target volume (0–1)
  var FADE_IN_MS = 900;
  var FADE_OUT_MS = 350;
  var SAVE_EVERY_MS = 1000;        // throttle for position saving
  var MAX_GAP_COMP_S = 5;          // compensate page-load gap only up to this
  var RESUME_ON_FIRST_INTERACTION = true; // if autoplay is blocked after the
                                          // visitor already enabled music

  var LABEL_PLAY = 'PLAY MUSIC';
  var LABEL_PAUSE = 'PAUSE MUSIC';
  var LABEL_ERROR = 'MUSIC UNAVAILABLE';

  /* ---------- Resolve audio URL (works under any sub-path) ---------- */
  var script = document.currentScript;
  var SRC;
  try {
    var base = script && script.src ? script.src : location.href;
    var custom = script && script.getAttribute('data-src');
    SRC = new URL(custom || '../audio/bgm.mp3', base).href;
  } catch (e) {
    SRC = 'audio/bgm.mp3';
  }

  /* ---------- localStorage helpers (can throw / be blocked) ---------- */
  function readState() {
    try {
      var o = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }
  function writeState(patch) {
    try {
      var o = readState();
      for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) o[k] = patch[k]; }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
    } catch (e) { /* storage unavailable: music still works for this page */ }
  }

  var ID = Math.random().toString(36).slice(2);
  var saved = readState();

  /* ---------- State ---------- */
  // AUTOPLAY: music is ON by default; it only stays off if the visitor
  // pressed Pause (saved.on === false). Browsers may still block sound until
  // the first click/keypress, which is then used to start it (see below).
  var wanted = saved.on !== false;  // visitor's intent (persisted)
  var failed = false;              // file missing / unsupported
  var pausedForVideo = false;
  var lastSave = 0;
  var fadeTimer = null;
  var gestureArmed = false;

  // Where to start: saved position, plus the tiny gap since the last page
  // saved it (only if it was actually playing and the gap is short).
  var startAt = Number(saved.t) || 0;
  if (saved.p === true && saved.ts) {
    var gap = (Date.now() - saved.ts) / 1000;
    if (gap > 0 && gap < MAX_GAP_COMP_S) startAt += gap;
  }

  /* ---------- Audio element (single instance) ---------- */
  var audio = new Audio();
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = 0;
  audio.setAttribute('aria-hidden', 'true');

  audio.addEventListener('loadedmetadata', function seek() {
    audio.removeEventListener('loadedmetadata', seek);
    if (isFinite(audio.duration) && audio.duration > 0 && startAt > 0) {
      try { audio.currentTime = startAt % audio.duration; } catch (e) {}
    }
  });
  audio.addEventListener('error', fail);
  audio.addEventListener('timeupdate', function () {
    var now = Date.now();
    if (!audio.paused && now - lastSave >= SAVE_EVERY_MS) { lastSave = now; savePosition(); }
  });
  audio.src = SRC;

  /* ---------- UI (injected, so HTML only needs one <script> tag) ---------- */
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'music-toggle';
  btn.className = 'music-toggle';
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML =
    '<span class="music-icon" aria-hidden="true"><i></i><i></i><i></i></span>' +
    '<span class="music-label">' + LABEL_PLAY + '</span>';
  var labelEl = btn.querySelector('.music-label');

  function isPlaying() { return !audio.paused && wanted && !failed; }

  function render() {
    var playing = isPlaying();
    btn.classList.toggle('is-playing', playing);
    btn.classList.toggle('is-error', failed);
    btn.disabled = failed;
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    labelEl.textContent = failed ? LABEL_ERROR : (playing ? LABEL_PAUSE : LABEL_PLAY);
    btn.title = failed ? 'Background music could not be loaded'
                       : (playing ? 'Pause background music' : 'Play background music');
  }

  function mount() {
    if (document.getElementById('music-toggle')) return;
    document.body.appendChild(btn);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  /* ---------- Core behaviour ---------- */
  function savePosition() {
    if (audio.readyState < 1) return; // never overwrite a good value with 0
    writeState({ t: audio.currentTime, ts: Date.now(), p: !audio.paused, owner: ID });
  }

  function fadeTo(target, ms, done) {
    clearInterval(fadeTimer);
    var from = audio.volume, steps = Math.max(1, Math.round(ms / 40)), i = 0;
    fadeTimer = setInterval(function () {
      i++;
      try { audio.volume = Math.min(1, Math.max(0, from + (target - from) * (i / steps))); } catch (e) {}
      if (i >= steps) { clearInterval(fadeTimer); if (done) done(); }
    }, 40);
  }

  function fail() {
    if (failed) return;
    failed = true;
    disarmGesture();
    try { audio.pause(); } catch (e) {}
    if (window.console) console.warn('[The Last Frame] Background music unavailable:', SRC);
    render();
  }

  // Try to start playback. `auto` = not triggered by the visitor's click.
  function start(auto) {
    if (failed || !audio.paused) return Promise.resolve(!audio.paused);
    clearInterval(fadeTimer);
    try { audio.volume = 0; } catch (e) {}
    var p;
    try { p = audio.play(); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function () {
      wanted = true;
      pausedForVideo = false;
      fadeTo(VOLUME, FADE_IN_MS);
      lastSave = Date.now();
      writeState({ on: true, owner: ID });
      savePosition();
      disarmGesture();
      render();
      return true;
    }, function (err) {
      var name = err && err.name;
      if (name === 'NotAllowedError') {
        // Browser blocked autoplay: keep the PLAY button, let visitor resume.
        if (auto && RESUME_ON_FIRST_INTERACTION) armGesture();
      } else if (name !== 'AbortError') {
        fail();
      }
      render();
      return false;
    });
  }

  function userPause() {
    wanted = false;
    pausedForVideo = false;
    writeState({ on: false, t: audio.readyState >= 1 ? audio.currentTime : saved.t, ts: Date.now(), p: false });
    // pause after the short fade-out (skipped if user hits play again)
    clearInterval(fadeTimer);
    fadeTo(0, FADE_OUT_MS, function () {
      if (!wanted) { audio.pause(); render(); }
    });
    render(); // label flips instantly (wanted is already false)
  }

  btn.addEventListener('click', function () {
    if (failed) return;
    if (isPlaying()) userPause();
    else if (!audio.paused) {            // pressed play during the fade-out
      wanted = true;
      fadeTo(VOLUME, FADE_IN_MS);
      writeState({ on: true, owner: ID });
      render();
    } else { wanted = true; start(false); }
  });

  /* ---------- Autoplay blocked → resume on first real interaction ---------- */
  function onGesture(e) {
    if (btn.contains(e.target)) return; // the button handles itself
    if (!wanted || failed) { disarmGesture(); return; }
    start(true);
  }
  function armGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) {
      document.addEventListener(ev, onGesture, true);
    });
  }
  function disarmGesture() {
    if (!gestureArmed) return;
    gestureArmed = false;
    ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) {
      document.removeEventListener(ev, onGesture, true);
    });
  }

  /* ---------- Persist position when leaving the page ---------- */
  function onLeave() { if (!audio.paused) savePosition(); }
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onLeave);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') onLeave();
  });

  /* ---------- Only one tab/page plays at a time ---------- */
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    var s; try { s = JSON.parse(e.newValue); } catch (err) { return; }
    if (s && s.owner && s.owner !== ID && s.on === true && !audio.paused) {
      audio.pause();            // another page took over playback
      render();
    }
  });

  /* ---------- Duck the music while a <video> (trailer) plays ---------- */
  document.addEventListener('play', function (e) {
    if (e.target && e.target.tagName === 'VIDEO' && !audio.paused) {
      pausedForVideo = true;
      savePosition();
      audio.pause();
      render();
    }
  }, true);
  function resumeAfterVideo(e) {
    if (e.target && e.target.tagName === 'VIDEO' && pausedForVideo && wanted) {
      var vids = document.getElementsByTagName('video');
      for (var i = 0; i < vids.length; i++) { if (!vids[i].paused && !vids[i].ended) return; }
      pausedForVideo = false;
      start(true);
    }
  }
  document.addEventListener('pause', resumeAfterVideo, true);
  document.addEventListener('ended', resumeAfterVideo, true);

  /* =========================================================
     SOFT NAVIGATION
     Clicking an internal page link (index / characters / gallery /
     contact) does NOT reload the document. The next page's HTML is
     fetched, its content swapped in, and the URL updated with the
     History API — so the single <audio> element above keeps playing
     with no gap and no autoplay permission needed.
     Anything unexpected (fetch error, file://, odd response) falls
     back to a normal full page load, where the localStorage resume
     logic above takes over.
     ========================================================= */
  var SOFT_NAV = !!(window.fetch && window.DOMParser && window.history && history.pushState) &&
                 location.protocol !== 'file:';
  var currentPath = location.pathname;
  var navToken = 0;
  var prefetched = {};

  function pageKey(u) { return u.origin + u.pathname + u.search; }

  function fetchPage(u) {
    var key = pageKey(u);
    if (!prefetched[key]) {
      prefetched[key] = fetch(key, { credentials: 'same-origin' }).then(function (r) {
        var type = r.headers.get('content-type') || '';
        if (!r.ok || type.indexOf('html') === -1) throw new Error('not an html page');
        return r.text();
      });
      prefetched[key].catch(function () { delete prefetched[key]; });
    }
    return prefetched[key];
  }

  function internalLink(a, e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    if (a.target && a.target !== '_self') return null;
    if (a.hasAttribute('download')) return null;
    var raw = a.getAttribute('href');
    if (!raw || raw.charAt(0) === '#') return null;       // in-page anchors & "#"
    var u;
    try { u = new URL(a.href, location.href); } catch (err) { return null; }
    if (u.origin !== location.origin) return null;
    if (!/\.html?$/i.test(u.pathname) && u.pathname.slice(-1) !== '/') return null;
    return u;
  }

  function runScripts(list) {
    list.forEach(function (s) {
      if (s.src) {
        if (/music\.js(\?|$)/.test(s.src)) return;          // never load a 2nd player
        var el = document.createElement('script');
        el.src = s.src; el.async = false;
        document.body.appendChild(el);
      } else if (s.text.trim()) {
        // Indirect eval = global scope for functions (inline onclick works),
        // but const/let stay local, so revisiting a page can't redeclare them.
        try { (0, eval)(s.text); } catch (err) { if (window.console) console.error(err); }
      }
    });
  }

  function swapIn(doc, u, scrollY) {
    // <head>: title, description, page-specific <style>, any new stylesheet
    document.title = doc.title;
    var newDesc = doc.querySelector('meta[name="description"]');
    var oldDesc = document.querySelector('meta[name="description"]');
    if (newDesc && oldDesc) oldDesc.setAttribute('content', newDesc.getAttribute('content') || '');
    Array.prototype.slice.call(document.head.querySelectorAll('style')).forEach(function (n) { n.parentNode.removeChild(n); });
    Array.prototype.slice.call(doc.head.querySelectorAll('style')).forEach(function (n) { document.head.appendChild(document.importNode(n, true)); });
    Array.prototype.slice.call(doc.head.querySelectorAll('link[rel="stylesheet"]')).forEach(function (l) {
      var href = new URL(l.getAttribute('href'), u.href).href;
      var have = Array.prototype.some.call(document.head.querySelectorAll('link[rel="stylesheet"]'), function (x) { return x.href === href; });
      if (!have) { var nl = document.createElement('link'); nl.rel = 'stylesheet'; nl.href = href; document.head.appendChild(nl); }
    });

    // <body>: replace everything except the music button
    var scripts = Array.prototype.slice.call(doc.body.querySelectorAll('script'));
    var collected = scripts.map(function (s) { return { src: s.getAttribute('src') ? new URL(s.getAttribute('src'), u.href).href : '', text: s.textContent }; });
    scripts.forEach(function (s) { s.parentNode.removeChild(s); });
    Array.prototype.slice.call(document.body.childNodes).forEach(function (n) { if (n !== btn) document.body.removeChild(n); });
    Array.prototype.slice.call(doc.body.childNodes).forEach(function (n) { document.body.appendChild(document.importNode(n, true)); });
    document.body.className = doc.body.className;
    document.body.style.overflow = '';
    document.body.appendChild(btn);                          // keep button last
    runScripts(collected);

    // scroll: saved position (back/forward), #hash target, or top
    var target = u.hash && document.getElementById(decodeURIComponent(u.hash.slice(1)));
    if (typeof scrollY === 'number') window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
    else if (target) target.scrollIntoView();
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

    // a trailer that was playing was removed with the old page
    if (pausedForVideo && wanted) { pausedForVideo = false; start(true); }
    render();
  }

  function go(u, pop, scrollY) {
    var token = ++navToken;
    fetchPage(u).then(function (html) {
      if (token !== navToken) return;                        // a newer click won
      var doc = new DOMParser().parseFromString(html, 'text/html');
      if (!doc.body || !doc.querySelector('main')) throw new Error('unexpected page');
      if (!pop) {
        try { history.replaceState({ scrollY: window.scrollY }, '', location.href); } catch (err) {}
        history.pushState({}, '', u.href);
      }
      currentPath = u.pathname;
      var run = function () { swapIn(doc, u, scrollY); };
      var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (document.startViewTransition && !calm) {   // ink-wipe between pages
        try { document.startViewTransition(run); } catch (err) { run(); }
      } else { run(); }
    }).catch(function () {
      if (token === navToken) location.href = u.href;        // fallback: normal load
    });
  }

  if (SOFT_NAV) {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var u = internalLink(a, e);
      if (!u) return;
      e.preventDefault();
      if (u.pathname === currentPath && u.search === location.search) {
        if (u.hash) { history.pushState({}, '', u.href); var t = document.getElementById(decodeURIComponent(u.hash.slice(1))); if (t) t.scrollIntoView(); }
        else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        return;
      }
      go(u, false);
    });
    // warm the cache so the swap feels instant
    function warm(e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      var u = a && internalLink(a, { button: 0 });
      if (u && u.pathname !== currentPath) fetchPage(u).catch(function () {});
    }
    ['mouseover', 'touchstart', 'focusin'].forEach(function (ev) { document.addEventListener(ev, warm, { passive: true }); });

    window.addEventListener('popstate', function (e) {
      if (location.pathname === currentPath) return;         // hash-only change (gallery lightbox)
      go(new URL(location.href), true, e.state && typeof e.state.scrollY === 'number' ? e.state.scrollY : 0);
    });
  }

  /* ---------- Kick off: resume if the visitor enabled music earlier ---------- */
  if (wanted) start(true);
  render();
})();
