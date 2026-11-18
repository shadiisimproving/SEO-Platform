/* What the Google Analytics screens say about their own numbers (SEO review 2026-11-17, W1, W2, W6, W11). One place, so
   Today, Channels, Conversions, Content and AI search say it the same way, in English and French.

     GA4W.word(english, d)   "Leads" → "Key events" (and the words built on it) while no site of the answer has picked its
                             lead events (d.lead_kind === "key_events"). Returns English, for t().
     GA4W.notes(d, opts)     short lines, one fact each, for under the number cards: the prompt to pick lead events, the days
                             GA4 changed how it counts key events, too little data before, unusual days, history being
                             read again. opts: { leads: true, visits: true }. HTML: every value is escaped.
     GA4W.hostsNote(list)    the warning for a property that also records another website's visits.
*/
(() => {
  "use strict";
  const KEY_EVENT_WORDS = {
    Leads: "Key events", leads: "key events", "Lead rate": "Key event rate, at most", "Pages that bring leads": "Pages with key events",
    "From visit to lead, by channel": "From visit to key event, by channel", "{n} visits didn't become a lead": "{n} visits had no key event",
    "No page brought a lead in this period.": "No page had a key event in this period.", "without a lead": "without a key event",
    "No leads in this period": "No key events in this period",
  };
  // Some sites of the answer picked their lead events and some didn't: each counts by its own rule, so the total is both
  // (code review 2026-11-18, #4).
  const MIXED_WORDS = { "Lead rate": "Lead rate, at most", Leads: "Leads and key events", leads: "leads and key events", "No leads in this period": "No leads or key events in this period" };
  const U = () => window.UI;
  const t = (s) => U().t(s);
  const esc = (s) => U().esc(s);
  const day = (iso) => new Intl.DateTimeFormat(U().locale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${iso}T00:00:00`));
  const num = (n) => new Intl.NumberFormat(U().locale()).format(n);
  const fill = (text, values) => Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), text);
  const keyEvents = (d) => d?.lead_kind === "key_events" || d?.kind === "key_events";
  const mixed = (d) => d?.lead_kind === "mixed" || d?.kind === "mixed";

  /* A number card's label on a phone has room for about 18 letters: the mixed total gets a short name there, its full name in
     the card's tip ("Leads and key events.", FR "Leads et événements clés."). */
  const SHORT_WORDS = { Leads: "Leads + key events" };
  function short(english, d) {
    return mixed(d) && SHORT_WORDS[english] ? SHORT_WORDS[english] : word(english, d);
  }
  function word(english, d) {
    if (mixed(d)) return MIXED_WORDS[english] || english;
    return keyEvents(d) ? KEY_EVENT_WORDS[english] || english : english;
  }

  const line = (sev, html) => `<p class="note ${sev} lv-note ga4-note"><span>${html}</span></p>`;
  const CHANGE = {
    stopped: "Google Analytics recorded no key event from {day}{host}.",
    started: "Google Analytics started counting about one key event per visit on {day}{host}.",
    rose: "Google Analytics started counting many more key events per visit on {day}{host}.",
    fell: "Google Analytics stopped counting a key event on most visits on {day}{host}.",
  };

  function notes(d, { leads = true, visits = true } = {}) {
    if (!d) return "";
    const out = [];
    if (leads && keyEvents(d)) {
      out.push(line("info", `${esc(t("Counting every Google Analytics key event, not only enquiries."))} <a href="#settings" data-settings-tab="sites">${esc(t("Pick which are leads in Settings → Sites."))}</a>`));
    }
    if (leads && mixed(d)) {
      const hosts = (d.key_event_hosts || []).slice(0, 3).map(esc).join(", ");
      out.push(line("info", `${esc(t("Sites without lead events picked count every key event"))}${hosts ? ` (<span dir="auto">${hosts}</span>)` : ""}. <a href="#settings" data-settings-tab="sites">${esc(t("Pick which are leads in Settings → Sites."))}</a>`));
    }
    const changes = (d.lead_check?.changes || d.changes || []);
    if (leads && changes.length) {
      const many = new Set(changes.map((c) => c.host)).size > 1;
      changes.slice(0, 3).forEach((c) => out.push(line("warn", `${esc(fill(t(CHANGE[c.kind] || CHANGE.rose), { day: day(c.day), host: many && c.host ? ` (${c.host})` : "" }))} ${esc(t("So no change is shown."))}`)));
    }
    if (visits && (d.little_before || d.note === "little_before")) out.push(line("info", esc(t("Too little data before to compare visits."))));
    // Some sites have too little data before: the change covers the others only, and says which were left out (N1, N3).
    const left = (d.little_hosts || []).filter(Boolean), kept = d.compared_count ?? (d.compared_sites || []).length;
    if (visits && left.length && !d.little_before && kept) {
      out.push(line("info", `${esc(fill(t("Visits change on {n} of {m} sites: too little data before on"), { n: num(kept), m: num(kept + left.length) }))} <span dir="auto">${left.slice(0, 3).map(esc).join(", ")}</span>.`));
    }
    // A site that records no lead or key event has no lead rate: its visits stay out of the rate, and it is named (W2b).
    const silent = (d.no_lead_hosts || []).filter(Boolean);
    if (leads && silent.length) {
      out.push(line("info", `${esc(t(keyEvents(d) ? "Left out of the rate, no key events recorded:" : "Left out of the rate, no leads or key events recorded:"))} <span dir="auto">${silent.slice(0, 3).map(esc).join(", ")}</span>.`));
    }
    const unusual = d.unusual;
    if (visits && unusual) {
      [...(unusual.runs || []), ...(unusual.runs_before || [])].slice(0, 2).forEach((r) => {
        out.push(line("warn", esc(fill(t("Unusual days {a} – {b}: {n} visits, about {u} a day usually."), { a: day(r.from), b: day(r.to), n: num(r.visits), u: num(r.usual) }))));
      });
      if (unusual.change !== null && unusual.change !== undefined) {
        const c = unusual.change;
        out.push(line("info", esc(fill(t("Visits change without those days: {c}."), { c: `${c > 0 ? "+" : c < 0 ? "−" : ""}${num(Math.abs(c))}%` }))));
      }
    }
    if (leads && d.reread_days > 0) out.push(line("info", esc(fill(t("Google Analytics history is being read again with key events by name: {n} days left."), { n: num(d.reread_days) }))));
    return out.length ? `<div class="ga4-notes">${out.join("")}</div>` : "";
  }

  function hostsNote(list) {
    if (!list?.length) return "";
    return list.map((item) => line("warn", esc(fill(t("This Google Analytics property also records {hosts}: check its data streams. Those visits are left out."), { hosts: item.hosts.map((h) => h.host).join(", ") })) + (item.host ? ` <span class="muted">(${esc(item.host)})</span>` : ""))).join("");
  }

  window.GA4W = { word, short, notes, hostsNote, keyEvents, mixed };
  window.FR = window.FR || {};
  Object.assign(window.FR, {
    "Key events": "Événements clés", "key events": "événements clés", "Key event rate": "Taux d'événements clés", "Key event rate, at most": "Taux évts clés (max)", "Lead rate, at most": "Taux de lead, au plus", "Pages with key events": "Pages avec des événements clés",
    "From visit to key event, by channel": "De la visite à l'événement clé, par canal", "{n} visits had no key event": "{n} visites sans événement clé",
    "No page had a key event in this period.": "Aucune page n'a eu d'événement clé sur cette période.", "without a key event": "sans événement clé",
    "No leads in this period": "Aucun lead sur cette période", "No key events in this period": "Aucun événement clé sur cette période",
    "No leads or key events in this period": "Aucun lead ni événement clé sur cette période",
    "Leads and key events": "Leads et événements clés", "leads and key events": "leads et événements clés",
    "Leads + key events": "Leads + évts clés", "Leads and key events.": "Leads et événements clés.",
    "Sites without lead events picked count every key event": "Les sites sans leads choisis comptent tous leurs événements clés",
    "Counting every Google Analytics key event, not only enquiries.": "Tous les événements clés de Google Analytics sont comptés, pas seulement les demandes.",
    "Pick which are leads in Settings → Sites.": "Choisissez ceux qui sont des leads dans Réglages → Sites.",
    "Google Analytics recorded no key event from {day}{host}.": "Google Analytics n'a enregistré aucun événement clé à partir du {day}{host}.",
    "Google Analytics started counting about one key event per visit on {day}{host}.": "Google Analytics s'est mis à compter environ un événement clé par visite le {day}{host}.",
    "Google Analytics started counting many more key events per visit on {day}{host}.": "Google Analytics s'est mis à compter bien plus d'événements clés par visite le {day}{host}.",
    "Google Analytics stopped counting a key event on most visits on {day}{host}.": "Google Analytics a cessé de compter un événement clé sur la plupart des visites le {day}{host}.",
    "So no change is shown.": "Aucune évolution n'est donc affichée.",
    "Too little data before to compare visits.": "Trop peu de données avant pour comparer les visites.",
    "Unusual days {a} – {b}: {n} visits, about {u} a day usually.": "Jours inhabituels du {a} au {b} : {n} visites, environ {u} par jour d'habitude.",
    "Visits change without those days: {c}.": "Évolution des visites sans ces jours : {c}.",
    "Google Analytics history is being read again with key events by name: {n} days left.": "L'historique Google Analytics est relu avec les événements clés par nom : {n} jours restants.",
    "This Google Analytics property also records {hosts}: check its data streams. Those visits are left out.": "Cette propriété Google Analytics enregistre aussi {hosts} : vérifiez ses flux de données. Ces visites sont écartées.",
    "Too little data before": "Trop peu de données avant",
    "Visits change on {n} of {m} sites: too little data before on": "Évolution des visites sur {n} des {m} sites : trop peu de données avant sur",
    "Left out of the rate, no key events recorded:": "Exclus du taux, aucun événement clé enregistré :",
    "Left out of the rate, no leads or key events recorded:": "Exclus du taux, aucun lead ni événement clé enregistré :",
  });
})();
