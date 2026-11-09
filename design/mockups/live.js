/* Runs after the sample data and before the screens. With a server, no sample row may ever show: only what's really there. */
(() => {
  "use strict";
  const served = location.protocol.startsWith("http");
  if (served && !window.BOOT) {
    // The app is there but its first answer (boot.js) failed, for example a rate limit or a server error.
    // Sample rows must not stand in: the page says so instead, and nothing reloads by itself, so a rate limit isn't made worse.
    window.SITES = []; window.ATTENTION = []; window.ATTENTION_EXTRA_INFO = 0;
    window.CHANGES = []; window.TASKS_NEXT = []; window.BACKLINKS = []; window.FOUND_LINKS = []; window.PROSPECTS = []; window.COMPETITOR_SITES = []; window.TEAM = [];
    window.addEventListener("load", () => {
      const el = (tag, style, words) => { const node = document.createElement(tag); node.style.cssText = style; if (words) node.textContent = words; return node; };
      const box = el("main", "font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#1f2937");
      const again = el("button", "font:inherit;padding:.5rem 1rem;border-radius:8px;border:1px solid #1d4ed8;background:#1d4ed8;color:#fff;cursor:pointer", "Reload");
      again.type = "button";
      again.addEventListener("click", () => location.reload());
      box.append(
        el("h1", "font-size:1.25rem", "The server didn't answer"),
        el("p", "", "The page couldn't load your data, so it shows nothing rather than something wrong. Wait a moment, then reload."),
        again,
      );
      document.body.replaceChildren(box);
    });
    return;
  }
  const boot = window.BOOT;
  if (!boot) return;
  window.SITES = boot.sites.map((s) => ({ id: `real-${s.id}`, realId: s.id, host: s.host, visits: 0, vd: 0, clicks: 0, cd: 0, alerts: 0, thru: "—", added: true }));
  window.ATTENTION = []; window.ATTENTION_EXTRA_INFO = 0;
  window.CHANGES = []; window.TASKS_NEXT = []; window.BACKLINKS = []; window.FOUND_LINKS = []; window.PROSPECTS = []; window.COMPETITOR_SITES = [];
  if (boot.team?.length) window.TEAM = boot.team; else window.TEAM = [];
})();
