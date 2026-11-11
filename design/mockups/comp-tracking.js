/* Tracking for one competitor of one site: On, Pages only or Off.

   On: everything. Pages only: no keyword numbers, its pages are still read. Off: paused, nothing read, nothing counted.
   None of them ever spends a search on a competitor: its positions only come from checks of your own keywords.
   COMP.trackingSwitch(c) draws the switch (list rows and the profile header), COMP.trackingNote(c) says what's hidden. */
(() => {
  "use strict";
  const COMP = window.COMP;
  const UI = () => window.UI;
  const t = (s) => UI().t(s);
  const esc = (v) => UI().esc(v);
  const attr = (s) => esc(t(s));
  const fill = (key, values = {}) => t(key).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));

  const CHOICES = [
    ["on", "On", "Keywords, pages and links: everything."],
    ["pages", "Pages only", "No keyword numbers; pages still read and links still count."],
    ["off", "Off", "Paused: no keyword numbers, no page reads. Stays in your list."],
  ];
  const NOTES = {
    pages: "Pages only: keyword numbers hidden, pages still read. Set to On to see them; nothing is lost.",
    off: "Tracking is off: keyword numbers hidden, pages not read. Turn it back on any time; nothing is lost.",
  };
  const SHORT = {
    pages: "Pages only: keyword numbers hidden.",
    off: "Tracking is off: no keyword numbers, no page reads.",
  };
  const busy = new Set();
  window.ICONS.pause = window.ICONS.pause || '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>';
  window.ICONS["eye-off"] = window.ICONS["eye-off"] || '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>';

  COMP.trackingOf = (c) => c?.tracking || "on";

  COMP.trackingSwitch = (c) => {
    if (!c || c.id === undefined) return "";
    const now = COMP.trackingOf(c);
    const name = c.display || c.host || "";
    return `<div class="seg ct-switch" role="group" aria-label="${esc(fill("Tracking for {name}", { name }))}">${CHOICES.map(([id, word, help]) =>
      `<button type="button" data-ct-set="${id}" data-ct-id="${c.id}" aria-pressed="${now === id}" data-tip="${attr(help)}" ${busy.has(c.id) ? "disabled" : ""}>${esc(t(word))}</button>`
    ).join("")}</div>`;
  };

  /* { short: true } is one line, for a tile or a header sentence; the full note goes where the keyword table would be. */
  COMP.trackingNote = (c, { short = false } = {}) => {
    const now = COMP.trackingOf(c);
    if (now === "on") return "";
    const words = short ? SHORT[now] : NOTES[now];
    return `<p class="note ct-note${short ? " ct-short" : ""}">${UI().icon(now === "off" ? "pause" : "eye-off")}<span>${esc(t(words))}</span></p>`;
  };
  /* Moz is left alone for a competitor that isn't on, so a hint to fetch its score shouldn't show. */
  COMP.trackingAllowsMoz = (c) => COMP.trackingOf(c) === "on";

  async function choose(button) {
    const id = Number(button.dataset.ctId), to = button.dataset.ctSet, site = COMP.siteId;
    if (busy.has(id) || button.getAttribute("aria-pressed") === "true") return;
    const group = button.closest(".ct-switch");
    const buttons = group ? [...group.querySelectorAll("[data-ct-set]")] : [button];
    const before = buttons.find((b) => b.getAttribute("aria-pressed") === "true");
    busy.add(id);
    buttons.forEach((b) => { b.setAttribute("aria-pressed", String(b === button)); b.disabled = true; });
    window.dispatchEvent(new Event("resize")); // moves the highlight now, before the answer comes back
    try {
      await COMP.api("PUT", `competitors/${id}/tracking`, { site_id: site, tracking: to });
      UI().toast(t({ on: "Tracking is on.", pages: "Pages only: keyword numbers are hidden.", off: "Tracking is off." }[to]));
    } catch (err) {
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === before)));
      UI().toast(t(err.message), { kind: "crit" });
    } finally {
      busy.delete(id);
      buttons.forEach((b) => { b.disabled = false; });
    }
    if (COMP.siteId === site) {
      await COMP.reload({ quiet: true });
      // The redraw replaces the buttons, so the keyboard goes back to the same choice.
      document.querySelector(`[data-ct-id="${id}"][data-ct-set="${to}"]`)?.focus({ preventScroll: true });
    }
  }

  document.addEventListener("click", (e) => {
    const button = e.target.closest?.("[data-ct-set]");
    if (!button) return;
    e.preventDefault();
    choose(button);
  });

  // ---- the sample: the switch works when the screens are opened as a plain file ------------------
  const KEYWORD_COUNTS = ["shared", "they_ahead", "i_ahead", "theirs_only"];
  const kept = new Map();
  COMP.sampleWrite("PUT competitors/(\\d+)/tracking", (match, body) => {
    const id = Number(match[1]), site = Number(body?.site_id), to = body?.tracking;
    if (!["on", "pages", "off"].includes(to)) { const err = new Error("Tracking is on, pages or off."); err.status = 400; throw err; }
    const get = window.COMP_SAMPLE.get;
    const row = get[`competitors?site_id=${site}`]?.competitors?.find((c) => c.id === id);
    if (!row) { const err = new Error("Competitor not found."); err.status = 404; throw err; }
    const key = `${site}|${id}`;
    const profile = get[`competitors/${id}/profile?site_id=${site}`];
    if (!kept.has(key)) kept.set(key, JSON.parse(JSON.stringify({ row, profile: profile || null })));
    const original = kept.get(key);
    Object.assign(row, original.row, { tracking: to });
    if (to !== "on") KEYWORD_COUNTS.forEach((k) => { row[k] = null; });
    if (profile && original.profile) {
      Object.assign(profile, JSON.parse(JSON.stringify(original.profile)), { tracking: to });
      if (to !== "on") {
        profile.keywords = []; profile.past_keywords = [];
        ["shared", "they_ahead", "i_ahead", "level", "theirs_only", "mine_only", "my_average", "their_average", "ai_cited_me", "ai_cited_them", "ai_overviews"].forEach((k) => { profile.compare[k] = null; });
        profile.timeline = profile.timeline.filter((e) => !/^(rank_|ai_)/.test(e.kind));
      }
    }
    return { competitor_id: id, tracking: to };
  });

  Object.assign(window.FR, {
    "On": "Activé", "Pages only": "Pages seulement", "Off": "Désactivé", "Tracking": "Niveau de suivi", "Tracking for {name}": "Niveau de suivi de {name}",
    "Keywords, pages and links: everything.": "Mots-clés, pages et liens : tout.",
    "No keyword numbers; pages still read and links still count.": "Aucun chiffre de mots-clés ; pages toujours lues, liens toujours comptés.",
    "Paused: no keyword numbers, no page reads. Stays in your list.": "En pause : aucun chiffre de mots-clés, aucune lecture de pages. Reste dans votre liste.",
    [NOTES.pages]: "Le suivi de ce concurrent est réglé sur Pages seulement : ses chiffres de mots-clés sont masqués. Ses pages sont toujours lues. Passez sur Activé pour les revoir : rien n'est perdu.",
    [NOTES.off]: "Le suivi de ce concurrent est désactivé : ses chiffres de mots-clés sont masqués et ses pages ne sont pas lues. Réactivez-le quand vous voulez : rien n'est perdu.",
    "Tracking is on.": "Le suivi est activé.", "Pages only: keyword numbers are hidden.": "Pages seulement : les chiffres de mots-clés sont masqués.", "Tracking is off.": "Le suivi est désactivé.",
    [SHORT.pages]: "Les chiffres de mots-clés sont masqués : le suivi est réglé sur Pages seulement.",
    [SHORT.off]: "Le suivi est désactivé : les chiffres de mots-clés sont masqués et les pages ne sont pas lues.",
    "Paused": "En pause", "Not tracked for keywords.": "Pas suivi pour les mots-clés.",
    "Tracking is on, pages or off.": "Le suivi est activé, pages seulement ou désactivé.",
    "Tracking is off, so its pages aren't read. Set it to On or Pages only first.": "Le suivi est désactivé : ses pages ne sont pas lues. Passez-le d'abord sur Activé ou Pages seulement.",
  });
})();
