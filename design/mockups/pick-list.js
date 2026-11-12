/* A box that shows what the app already knows as soon as it's clicked, and narrows as you type. It replaces the browser's
   own suggestion list (<datalist>), which shows nothing until something is typed.
   PickList.html({ id, placeholder, label }) draws it. PickList.set(id, { items, onPick, onTyped, empty }) says what it lists:
   items() returns (or promises) [{ key, label, sub, fact, icon }]; onPick(item) runs on a choice; onTyped(text), when given,
   lets Enter keep words that aren't in the list. Keyboard: arrows move, Enter picks, Escape closes.
   Everything drawn goes through UI.setHTML (DOMPurify), with every value escaped.
   PickList.detach(box) takes the boxes inside out of their form (form="pl-none", set here because DOMPurify drops it):
   boxes come and go, and panel drafts count a form's fields by position. What is picked is kept by the screen. */
(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const t = (word) => (window.UI?.state?.lang === "fr" && window.FR?.[word]) || word;
  const paint = (el, html) => window.UI.setHTML(el, html);
  const fold = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const SHOWN = 80; // more than this asks for a few letters instead of a long scroll
  const lists = new Map(); // id: { items, onPick, onTyped, empty, loaded, active, shown }

  const html = ({ id, placeholder = "", label = "" }) => `<div class="pl" data-pl="${esc(id)}">
      <input class="input pl-input" id="${esc(id)}" type="text" role="combobox" aria-expanded="false" aria-controls="${esc(id)}-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" dir="auto" maxlength="500" placeholder="${esc(placeholder)}"${label ? ` aria-label="${esc(label)}"` : ""}>
      <span class="pl-caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>
      <div class="pl-pop" hidden><ul class="pl-list" id="${esc(id)}-list" role="listbox"${label ? ` aria-label="${esc(label)}"` : ""}></ul><p class="pl-foot" hidden></p></div>
    </div>`;

  function set(id, config) { lists.set(id, { ...config, loaded: null, active: -1, shown: [] }); }

  const parts = (input) => {
    const box = input.closest(".pl");
    return { pop: box.querySelector(".pl-pop"), list: box.querySelector(".pl-list"), foot: box.querySelector(".pl-foot") };
  };
  const note = (text) => `<li class="pl-note" role="presentation">${esc(text)}</li>`;

  async function draw(input) {
    const one = lists.get(input.id);
    if (!one) return;
    const { pop, list, foot } = parts(input);
    pop.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!one.loaded) {
      paint(list, note(t("Loading…")));
      foot.hidden = true;
      one.loaded = Promise.resolve().then(one.items).catch(() => []);
    }
    const all = (await one.loaded) || [];
    if (document.activeElement !== input) return;
    const words = fold(input.value).split(/\s+/).filter(Boolean);
    const hits = words.length ? all.filter((item) => { const hay = fold(`${item.label} ${item.sub || ""}`); return words.every((w) => hay.includes(w)); }) : all;
    one.shown = hits.slice(0, SHOWN);
    one.active = one.shown.length ? Math.min(Math.max(one.active, 0), one.shown.length - 1) : -1;
    if (!one.shown.length) {
      const typed = input.value.trim();
      paint(list, note(typed && one.onTyped ? t("Not in the list. Press Enter to add it as written.") : all.length ? t("Nothing matches.") : one.empty || t("Nothing to pick yet.")));
    } else {
      paint(list, one.shown.map((item, i) => `<li class="pl-opt" role="option" id="${esc(input.id)}-o${i}" data-pl-i="${i}" aria-selected="${i === one.active}">${item.icon || ""}<span class="pl-main"><span class="pl-label" dir="auto">${esc(item.label)}</span>${item.sub ? `<span class="pl-sub" dir="auto">${esc(item.sub)}</span>` : ""}</span>${item.fact ? `<span class="pl-fact">${item.fact}</span>` : ""}</li>`).join(""));
    }
    if (one.active >= 0) input.setAttribute("aria-activedescendant", `${input.id}-o${one.active}`); else input.removeAttribute("aria-activedescendant");
    const more = hits.length - one.shown.length;
    foot.textContent = more > 0 ? `${hits.length.toLocaleString(window.UI?.locale?.())} ${t("in the list. Type to narrow it.")}` : "";
    foot.hidden = !foot.textContent;
  }

  function close(input) {
    parts(input).pop.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    const one = lists.get(input.id);
    if (one) one.active = -1;
  }

  function choose(input, index) {
    const one = lists.get(input.id);
    const item = one?.shown[index];
    if (!item) return;
    input.value = "";
    one.onPick(item);
    one.active = 0;
    one.loaded = null; // items() is asked again, so what was just picked leaves the list
    draw(input); // stays open, so several can be picked in a row
  }

  function move(input, step) {
    const one = lists.get(input.id);
    if (!one || !one.shown.length) return;
    one.active = (one.active + step + one.shown.length) % one.shown.length;
    one.moved = true;
    const { list } = parts(input);
    list.querySelectorAll(".pl-opt").forEach((li, i) => li.setAttribute("aria-selected", String(i === one.active)));
    input.setAttribute("aria-activedescendant", `${input.id}-o${one.active}`);
    list.querySelector(`[data-pl-i="${one.active}"]`)?.scrollIntoView({ block: "nearest" });
  }

  const isPick = (el) => el instanceof Element && el.matches(".pl-input");
  document.addEventListener("focusin", (e) => { if (isPick(e.target)) draw(e.target); });
  document.addEventListener("input", (e) => { if (isPick(e.target)) { const one = lists.get(e.target.id); if (one) { one.active = 0; one.moved = false; } draw(e.target); } });
  document.addEventListener("focusout", (e) => {
    if (!isPick(e.target)) return;
    const input = e.target;
    setTimeout(() => { if (input.isConnected && document.activeElement !== input) close(input); }, 0);
  });
  // A click in the list keeps the focus in the box, so it stays open for the next pick.
  document.addEventListener("mousedown", (e) => {
    const pop = e.target instanceof Element && e.target.closest(".pl-pop");
    if (!pop) return;
    e.preventDefault();
    const li = e.target.closest(".pl-opt");
    if (li) choose(pop.closest(".pl").querySelector(".pl-input"), Number(li.dataset.plI));
  });
  document.addEventListener("click", (e) => {
    const caret = e.target instanceof Element && e.target.closest(".pl-caret");
    if (caret) caret.closest(".pl").querySelector(".pl-input").focus();
  });
  document.addEventListener("keydown", (e) => {
    if (!isPick(e.target)) return;
    const input = e.target, one = lists.get(input.id);
    if (!one) return;
    const open = !parts(input).pop.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!open) draw(input); else move(input, e.key === "ArrowDown" ? 1 : -1); return; }
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(input); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const typed = input.value.trim();
      // Typed and Enter keeps the words as typed, unless they are a row of the list; arrows then Enter picks the row.
      const exact = typed ? one.shown.findIndex((item) => fold(item.label) === fold(typed)) : -1;
      if (open && one.shown.length && (exact >= 0 || one.moved || !typed || !one.onTyped)) { choose(input, exact >= 0 && !one.moved ? exact : one.active); one.moved = false; return; }
      if (typed && one.onTyped) { input.value = ""; one.onTyped(typed); one.loaded = null; draw(input); }
    }
  }, true);

  /* Ask again next time it opens, for example when the site changed or something was picked. */
  const forget = (id) => { const one = lists.get(id); if (one) one.loaded = null; };

  const detach = (root) => root.querySelectorAll(".pl-input").forEach((input) => input.setAttribute("form", "pl-none"));

  window.PickList = { html, set, forget, detach };
})();
