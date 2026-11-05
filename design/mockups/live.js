/* Runs after the sample data and before the screens. With a server, no sample row may ever show: only what's really there. */
(() => {
  "use strict";
  const boot = window.BOOT;
  if (!boot) return;
  window.SITES = boot.sites.map((s) => ({ id: `real-${s.id}`, realId: s.id, host: s.host, visits: 0, vd: 0, clicks: 0, cd: 0, alerts: 0, thru: "—", added: true }));
  window.ATTENTION = []; window.ATTENTION_EXTRA_INFO = 0;
  window.CHANGES = []; window.TASKS_NEXT = []; window.BACKLINKS = []; window.FOUND_LINKS = []; window.PROSPECTS = []; window.COMPETITOR_SITES = [];
  if (boot.team?.length) window.TEAM = boot.team; else window.TEAM = [];
})();
