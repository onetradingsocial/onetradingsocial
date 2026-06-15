/* TradingSocial landing — interactions */
(function () {
  "use strict";

  /* ---- Sticky nav ---- */
  const nav = document.querySelector(".nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 12);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- Scroll reveal ---- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ---- Hero variant switcher ---- */
  const variants = ["A", "B", "C"];
  const switchBtns = document.querySelectorAll(".switcher button");
  function setVariant(v) {
    variants.forEach((x) => {
      const el = document.getElementById("hero" + x);
      if (el) el.classList.toggle("active", x === v);
    });
    switchBtns.forEach((b) => b.classList.toggle("active", b.dataset.v === v));
    try { localStorage.setItem("ts_hero", v); } catch (e) {}
  }
  switchBtns.forEach((b) => b.addEventListener("click", () => setVariant(b.dataset.v)));
  let saved = "A";
  try { saved = localStorage.getItem("ts_hero") || "A"; } catch (e) {}
  setVariant(saved);

  /* ---- Loop pulse animation ---- */
  const loop = document.querySelector(".loop");
  if (loop) {
    const nodes = loop.querySelectorAll(".loop-node");
    const fill = loop.querySelector(".loop-track i");
    let i = 0;
    let started = false;
    const startLoop = () => {
      if (started) return;
      started = true;
      setInterval(() => {
        nodes.forEach((n, idx) => n.classList.toggle("on", idx === i));
        if (fill) {
          const pct = (i / (nodes.length - 1)) * 100;
          fill.style.width = pct + "%";
          fill.style.transition = "width .55s cubic-bezier(.3,.7,.2,1)";
        }
        i = (i + 1) % nodes.length;
      }, 1200);
    };
    const loopIO = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) startLoop(); });
    }, { threshold: 0.3 });
    loopIO.observe(loop);
  }

  /* ---- Leaderboard tab toggle (cosmetic) ---- */
  document.querySelectorAll(".lb-tabs").forEach((tabs) => {
    tabs.addEventListener("click", (e) => {
      const t = e.target.closest(".lb-tab");
      if (!t) return;
      tabs.querySelectorAll(".lb-tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
    });
  });

  /* ---- Product showcase tabs ---- */
  const showTabs = document.querySelectorAll(".show-tab");
  showTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.show;
      showTabs.forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".show-panel").forEach((p) => {
        p.classList.toggle("active", p.dataset.panel === key);
      });
    });
  });

  /* ---- Animated number count-up ---- */
  const countEls = document.querySelectorAll("[data-count]");
  const countIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || "";
      const dur = 1400;
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min((now - start) / dur, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        const val = target * ease;
        el.textContent = (target % 1 === 0 ? Math.round(val) : val.toFixed(1)) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      countIO.unobserve(el);
    });
  }, { threshold: 0.5 });
  countEls.forEach((el) => countIO.observe(el));
})();
