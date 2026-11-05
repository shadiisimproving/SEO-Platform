# Design rules: SEO Command Center

The chosen look is **Clear: white, with a few colours to tell things apart** (owner's choice, 2026-11-05, replacing Blue on Light glass). Too much blue made things hard to tell apart. Every new screen follows this file. The tokens live in `design/mockups/look-clear.css`, on top of `mockup.css`.

## Look
- White cards and a white, floating side menu on a very pale grey page. Soft shadows and a thin line separate things. A little frosted glass stays on the top bar, where content scrolls under it.
- **Blue is for what you act on or where you are:** main buttons, selected filters, links, the current page, charts. Backgrounds, cards and rows carry no blue.
- **Blue, purple, teal and indigo tell things apart:** icons on number cards and tabs, labels such as a data source. They carry no meaning of their own. Never write a raw colour in a component: use `--c-blue`, `--c-purple`, `--c-teal`, `--c-indigo` and their `-pale` versions.
- Status colours are reserved for status and always come with an icon and a word: good, warn, serious, crit. A decorative colour is never green, amber or red.
- **Comparing two pages:** mine is always `--c-blue` and on the left or on top, theirs is always `--c-purple`. These only say whose it is. Facts never turn green or red, because the app doesn't say which page is better; only who ranks higher gets a status colour.
- Dark mode is charcoal, not navy, so the colours stand out. Dark mode and language are switched at the bottom of the side menu.
- No link to the owner's company branding: no logo or fonts. The blue and the pale surfaces follow the CRM's, at the owner's request (2026-11-05).
- A third-party brand's logo sits beside its name every time the name appears (owner's rule, 2026-11-05). `brands.js` does this on the rendered text, in both languages, so new text gets it with nothing to remember. A new brand needs one line in `brands.js` and its real logo in `logos/`: check the file by eye, because favicons are often a parent company's or a generic icon. Words someone typed or read from another site carry `dir="auto"` and are left alone. `tests/ui/flow_brand_logos.cjs` lists any name without a logo.

## Type and numbers
- Geist for interface and numbers, Geist Mono for URLs and keywords, self-hosted. Noto Sans Arabic for Arabic text.
- Nothing below 12 px.
- Numbers are centred in every table, under a centred heading (owner's rule, 2026-11-05). A cell of action buttons stays at the end of its row. On phones, where tables become cards, values sit on the right.
- Aligned equal-width digits in tables and axes. Numbers follow the language: `1 706` in French, `1,706` in English.
- Text from other websites, and anything someone typed, carries `dir="auto"`, so Arabic and Hebrew read correctly.

## Behaviour
- One main action per screen.
- Forms keep what was typed: closing a panel keeps a draft, and API keys are never kept in drafts.
- Errors appear beside the field and say how to fix it.
- Destructive actions have a confirm dialog, or Undo in the toast.
- A note can hold images and any file, up to 25 MB each. Only bytes that really are PNG, JPEG, GIF or WebP show in the browser; everything else, SVG and HTML included, can only be downloaded. The files live in `var/note-files` (or `SEO_NOTE_FILES`), which hosting must keep across deploys and back up with the database.
- A position beyond the depth checked shows as `>10`, never as a number.
- Unknown is unknown: never show 0 for a blank score, or "no" for something not captured.
- Toasts sit bottom-left. Panels close with Escape. Focus returns to what opened them.
- A menu item or tab that isn't built is muted with a "Soon" tag, and there's nothing to click.
- A saved action never says "saved" when nothing changed: say what's missing, beside the field.

## Motion
- Fade only the glass leaf elements: fading a parent kills the blur inside it.
- Count-up numbers, sparkline draw-in, and a sliding highlight on tabs.
- Everything is off under `prefers-reduced-motion`. Solid surfaces under `prefers-reduced-transparency`, or where backdrop-filter isn't supported.

## Widths
- The menu collapses to icons at 861-1240 px (its toggle wins), and is a drawer at 860 px and below.
- Tables become cards at 640 px and below, using `data-label` on each cell.
- No sideways page scroll at any width. A long URL wraps.

## Text
- Plain words, sentence case. "Click rate" not CTR. "Same keyword on 2 pages" not cannibalisation.
- Every string goes through `t()` and has a French translation.

## Adding a screen
- A screen in its own file registers in `window.SCREENS`, and gets helpers from `window.UI` (bottom of `mockup.js`).
- A Competitors tab registers with `COMP.addTab()` (`competitors.js`) and calls the server through `COMP.api()`, which falls back to `comp-sample-data.js` when opened as a plain file.
- All HTML goes through `setHTML` (DOMPurify), and all values through `esc()`.
- `window.FR` is shared by every screen: `Object.assign` overwrites a word another screen already uses. Add only words that are new, or give yours its own key.
- A finding gets `UI.taskButton()`, so it can turn into a task. Never add a button that says it did something the app can't do yet: say what's not built.
