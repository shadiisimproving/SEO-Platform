/* The new design's one chart look (owner, 2026-11-26, picked "1 · Soft area" on design/redesign-2026-11-24/chart-styles.html):
   a smooth cobalt line with a soft cobalt fade under it, the period before as a thin dashed grey line, no bars.
   Every chart of the new design draws through here, so they all look the same. HTML strings for setHTML / UI.fragment
   (DOMPurify keeps svg, defs, linearGradient, stop, path, circle, title, g, rect).

   CBChart.plot({ points, label, fmt, best, height, invert })
     points  [{ day: "2026-10-27", now: 25, was: 28 }, ...]   now/was may be null (a gap; "—" in the day's tip)
     label   words for screen readers ("Visits each day, 27 Oct – 23 Nov")
     fmt     (v) => text for the numbers on the left and in each day's tip (default UI.num)
     best    true: a dot and a small dark label on the highest day ("11 · best")
     height  px, default 250
     invert  true for a position (lower is better): the scale runs upside down
   CBChart.mini(now, was, { invert, fit })   the small graph on a number card: the same look, no axis, aria-hidden;
                                       fit: scale to the values' own range instead of from 0 (a score 91 → 95)
   CBChart.path(values, X, Y)           the smooth path, for a screen that draws its own svg */
(() => {
  "use strict";
  const UI = () => window.UI;
  const num = (v) => (UI()?.num ? UI().num(v) : String(v));
  const day = (iso) => new Intl.DateTimeFormat(UI()?.locale?.() || "en", { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`));
  const esc = (s) => (UI()?.esc ? UI().esc(s) : String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
  const t = (w) => (UI()?.t ? UI().t(w) : w);
  let seq = 0;

  /* Smooth through the points without overshooting: a monotone cubic, so a line never dips below zero or above a peak. */
  function path(pts) {
    const n = pts.length;
    if (!n) return "";
    if (n === 1) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}h.01`;
    const d = [], m = [];
    for (let i = 0; i < n - 1; i += 1) d[i] = (pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i += 1) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    let out = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i += 1) {
      const h = (pts[i + 1][0] - pts[i][0]) / 3;
      out += `C${(pts[i][0] + h).toFixed(1)} ${(pts[i][1] + m[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)} ${(pts[i + 1][1] - m[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
    }
    return out;
  }
  // Runs of known values: a null breaks the line (never drawn as 0).
  const runs = (vals, X, Y) => {
    const out = []; let run = [];
    vals.forEach((v, i) => { if (v === null || v === undefined) { if (run.length) out.push(run); run = []; } else run.push([X(i), Y(v)]); });
    if (run.length) out.push(run);
    return out;
  };
  const niceStep = (span) => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000].find((s) => span / s <= 4.2) || 100000;
  const fade = (id, strong) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2F5BEA" stop-opacity="${strong ? 0.26 : 0.2}"/><stop offset="1" stop-color="#2F5BEA" stop-opacity="0"/></linearGradient></defs>`;

  function plot({ points = [], label = "", fmt = num, best = true, height = 250, invert = false } = {}) {
    const n = points.length, W = 1000, H = 240;
    if (n < 2) return "";
    const vals = points.flatMap((p) => [p.now, p.was]).filter((v) => v !== null && v !== undefined);
    if (!vals.length) return "";
    let lo = invert ? Math.min(...vals) : Math.min(0, ...vals), hi = Math.max(...vals);
    if (hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo), top = Math.ceil(hi / step) * step, bottom = invert ? Math.floor(lo / step) * step : Math.min(0, Math.floor(lo / step) * step);
    const Y = (v) => { const f = (v - bottom) / (top - bottom || 1); return invert ? 6 + f * (H - 6) : H - f * (H - 6); };
    const X = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
    const id = `cbf${(seq += 1)}`;
    let grid = "", ticks = "";
    for (let v = bottom; v <= top + 1e-9; v += step) {
      grid += `<line x1="0" x2="${W}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="${v === bottom && !invert ? "cbc-base" : "cbc-grid"}"/>`;
      ticks += `<span style="top:${((Y(v) / H) * 100).toFixed(2)}%">${esc(fmt(v))}</span>`;
    }
    const now = points.map((p) => p.now), was = points.map((p) => p.was);
    const area = runs(now, X, Y).filter((r) => r.length > 1).map((r) => `${path(r)}L${r[r.length - 1][0].toFixed(1)} ${invert ? 0 : H}L${r[0][0].toFixed(1)} ${invert ? 0 : H}Z`).join("");
    const line = (list) => runs(list, X, Y).map(path).join("");
    const hasWas = was.some((v) => v !== null && v !== undefined);
    const slot = W / n;
    const hits = points.map((p, i) => {
      const tip = `${day(p.day)}: ${p.now === null || p.now === undefined ? "—" : fmt(p.now)}${hasWas ? ` · ${t("before")}: ${p.was === null || p.was === undefined ? "—" : fmt(p.was)}` : ""}`;
      return `<g class="cbc-day"><title>${esc(tip)}</title><rect x="${Math.max(0, X(i) - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" class="cbc-hit"/><line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="0" y2="${H}" class="cbc-cross"/></g>`;
    }).join("");
    let mark = "";
    if (best) {
      let b = -1;
      now.forEach((v, i) => { if (v !== null && v !== undefined && (b < 0 || (invert ? v < now[b] : v > now[b]))) b = i; });
      if (b >= 0) {
        const left = ((X(b) / W) * 100).toFixed(2), top2 = ((Y(now[b]) / H) * 100).toFixed(2);
        mark = `<i class="cbc-dot" style="left:${left}%;top:${top2}%"></i><span class="cb-callout" style="left:${left}%;top:${top2}%">${esc(fmt(now[b]))} · ${t("best")}</span>`;
      }
    }
    const marks = [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1].filter((v, i, a) => a.indexOf(v) === i);
    const dates = marks.map((i) => `<span style="left:${((X(i) / W) * 100).toFixed(2)}%">${esc(day(points[i].day))}</span>`).join("");
    return `<div class="cb-plot cbc" style="height:${height}px" role="img" aria-label="${esc(label)}">
      <div class="cb-ticks" aria-hidden="true">${ticks}</div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${fade(id, true)}${grid}
        ${area ? `<path class="cbc-area" fill="url(#${id})" d="${area}"/>` : ""}${hasWas ? `<path class="cbc-was" d="${line(was)}"/>` : ""}<path class="cbc-now" d="${line(now)}"/>${hits}</svg>${mark}
      <div class="cb-dates" aria-hidden="true">${dates}</div></div>`;
  }

  /* The small graph on a number card: the same soft area, the period before dashed, scaled together. */
  function mini(now, was, { invert = false, fit = false } = {}) {
    const a = (now || []).map((v) => (v === null || v === undefined ? null : Number(v))), b = (was || []).map((v) => (v === null || v === undefined ? null : Number(v)));
    const known = a.concat(b).filter((v) => v !== null);
    if (a.filter((v) => v !== null).length < 2) return "";
    const W = 100, H = 36, n = Math.max(a.length, b.length);
    let lo = invert || fit ? Math.min(...known) : Math.min(0, ...known), hi = Math.max(...known);
    if (fit && !invert) { const pad = Math.max(1, (hi - lo) * 0.25); lo -= pad; hi += pad / 2; }
    if (hi === lo) hi = lo + 1;
    const X = (i) => (i / (n - 1)) * W, Y = (v) => { const f = (v - lo) / (hi - lo); return invert ? 2 + f * (H - 4) : H - 1 - f * (H - 4); };
    const id = `cbm${(seq += 1)}`;
    const area = runs(a, X, Y).filter((r) => r.length > 1).map((r) => `${path(r)}L${r[r.length - 1][0].toFixed(1)} ${H}L${r[0][0].toFixed(1)} ${H}Z`).join("");
    const line = (list) => runs(list, X, Y).map(path).join("");
    return `<svg class="cbc-mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${fade(id, false)}${area && !invert ? `<path class="cbc-area" fill="url(#${id})" d="${area}"/>` : ""}${b.some((v) => v !== null) ? `<path class="cbc-was" d="${line(b)}"/>` : ""}<path class="cbc-now" d="${line(a)}"/></svg>`;
  }

  window.CBChart = { plot, mini, path: (values, X, Y) => runs(values, X, Y).map(path).join("") };
  window.FR = window.FR || {};
  if (window.FR.best === undefined) window.FR.best = "meilleur";
  if (window.FR.before === undefined) window.FR.before = "avant";
})();
