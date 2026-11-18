// What the Google Analytics screens say under their numbers (final review 2026-11-18, W2b, N1, N3, N4).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load(lang = "en") {
  const window = { FR: {} };
  window.UI = {
    t: (s) => (lang === "fr" && window.FR[s]) || s,
    esc: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
    locale: () => (lang === "fr" ? "fr-FR" : "en-GB"),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "design", "mockups", "ga4-words.js"), "utf8"), { window, Intl });
  return window;
}
const plain = (html) => html.replace(/<[^>]+>/g, "");

test("a key event rate is labelled as an upper bound, never as a lead rate", () => {
  const w = load();
  assert.strictEqual(w.GA4W.word("Lead rate", { lead_kind: "key_events" }), "Key event rate, at most");
  assert.strictEqual(w.GA4W.word("Lead rate", { lead_kind: "mixed" }), "Lead rate, at most");
  assert.strictEqual(w.GA4W.word("Lead rate", { lead_kind: "leads" }), "Lead rate");
  assert.strictEqual(load("fr").UI.t("Key event rate, at most"), "Taux évts clés (max)");
});

test("the sites left out of the rate and of the change are named", () => {
  const w = load();
  const said = plain(w.GA4W.notes({ lead_kind: "key_events", no_lead_hosts: ["noforms.example"], little_hosts: ["late.example"], compared_sites: [1] }));
  assert.match(said, /Left out of the rate, no key events recorded: noforms\.example\./);
  assert.match(said, /Visits change on 1 of 2 sites: too little data before on late\.example\./);
  // Every site with too little before: the old line alone.
  const all = plain(w.GA4W.notes({ little_before: true, little_hosts: ["late.example"], compared_sites: [] }));
  assert.match(all, /Too little data before to compare visits\./);
  assert.doesNotMatch(all, /of 1 sites/);
  // Today sends its own count.
  assert.match(plain(w.GA4W.notes({ little_hosts: ["a.example", "b.example"], compared_count: 1 })), /Visits change on 1 of 3 sites: too little data before on a\.example, b\.example\./);
});

test("the same lines in French", () => {
  const w = load("fr");
  const said = plain(w.GA4W.notes({ lead_kind: "leads", no_lead_hosts: ["noforms.example"], little_hosts: ["late.example"], compared_sites: [1] }));
  assert.match(said, /Exclus du taux, aucun lead ni événement clé enregistré : noforms\.example\./);
  assert.match(said, /Évolution des visites sur 1 des 2 sites : trop peu de données avant sur late\.example\./);
});
