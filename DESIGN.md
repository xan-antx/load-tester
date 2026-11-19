---
name: Elevate Load Tester
description: A dark instrument console that turns a load test into a verdict you can trust.
colors:
  graphite-page: "#111315"
  graphite-panel: "#171A1D"
  graphite-raised: "#1E2226"
  graphite-inset: "#0D0F11"
  seam: "#2C3237"
  seam-subtle: "#22272B"
  readout-white: "#E3E6E8"
  caption-grey: "#8D969E"
  faint-grey: "#818A92"
  signal-teal: "#2DD4BF"
  signal-teal-bright: "#5EEAD4"
  signal-teal-wash: "rgba(45, 212, 191, 0.10)"
  on-signal: "#0B1312"
  pass-green: "#3FB950"
  pass-green-wash: "rgba(63, 185, 80, 0.12)"
  reject-amber: "#D29922"
  reject-amber-wash: "rgba(210, 153, 34, 0.13)"
  throttle-blue: "#58A6FF"
  throttle-blue-wash: "rgba(88, 166, 255, 0.12)"
  fault-red: "#F85149"
  fault-red-wash: "rgba(248, 81, 73, 0.12)"
  dead-line-grey: "#8B949E"
  dead-line-wash: "rgba(139, 148, 158, 0.12)"
  leak-violet: "#C297FF"
  leak-violet-wash: "rgba(194, 151, 255, 0.12)"
  trace-iris: "#9085e9"
  trace-rose: "#d55181"
  graticule: "#262B30"
  scrollbar-thumb: "#3A4148"
typography:
  readout:
    fontFamily: "IBM Plex Mono, ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "28px"
    fontWeight: 400
    lineHeight: 1.2
    fontFeature: "tnum"
  verdict:
    fontFamily: "Barlow, Segoe UI, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
  title:
    fontFamily: "Barlow, Segoe UI, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.01em"
  heading:
    fontFamily: "Barlow, Segoe UI, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Barlow, Segoe UI, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  meta:
    fontFamily: "Barlow, Segoe UI, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-teal}"
    textColor: "{colors.on-signal}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.signal-teal-bright}"
    textColor: "{colors.on-signal}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.readout-white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.graphite-raised}"
  button-disabled:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.faint-grey}"
  button-small:
    typography: "{typography.meta}"
    padding: "4px 12px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.signal-teal}"
    typography: "{typography.meta}"
    padding: "4px 0"
  toggle-pressed:
    backgroundColor: "{colors.signal-teal-wash}"
    textColor: "{colors.signal-teal}"
    typography: "{typography.meta}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  input:
    backgroundColor: "{colors.graphite-inset}"
    textColor: "{colors.readout-white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  load-panel:
    backgroundColor: "{colors.graphite-panel}"
    rounded: "{rounded.lg}"
    padding: "16px"
  sub-panel:
    backgroundColor: "{colors.graphite-raised}"
    rounded: "{rounded.md}"
  chip:
    backgroundColor: "{colors.graphite-inset}"
    textColor: "{colors.caption-grey}"
    typography: "{typography.data}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "20px"
  segmented-pressed:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.readout-white}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  preset-pressed:
    backgroundColor: "{colors.signal-teal-wash}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.md}"
    padding: "8px 4px"
  run-pill:
    backgroundColor: "{colors.signal-teal-wash}"
    textColor: "{colors.readout-white}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  offline-banner:
    backgroundColor: "{colors.fault-red-wash}"
    textColor: "{colors.readout-white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  findings-headline:
    textColor: "{colors.readout-white}"
    typography: "{typography.verdict}"
  bug-list:
    backgroundColor: "{colors.graphite-raised}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
  verdict-pass:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.pass-green}"
    typography: "{typography.readout}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
  verdict-fail:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.fault-red}"
    typography: "{typography.readout}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
  outcome-strip:
    backgroundColor: "{colors.graticule}"
    rounded: "{rounded.sm}"
    height: "10px"
---

# Design System: Elevate Load Tester

## Overview

**Creative North Star: "The Instrument Console"**

Think of a bench instrument with a quiet graphite casing. The panels step back
so the measured result comes forward. The casing is four close graphite layers
with thin seams between them and no shadows. Everything that is a reading (a
number, a URL, an ID, a payload, a status code) is set in IBM Plex Mono with
tabular figures. Everything that explains is set in Barlow. Colour appears only
where a reading means something. Signal Teal marks what you can act on, and six
status hues name how each request ended. Nothing is tinted for decoration.

The console is dense and calm. It is laid out for a laptop on a desk and for
the same laptop on a projector during evaluation demos, so the verdict and the
headline numbers must stay legible from the back of a room. It is dark only,
with no light theme. Fonts are self-hosted (`code/frontend/public/fonts`), so
the console renders offline exactly as it does online.

All colours, type sizes, spacing, radii, z-index values and durations live in
`code/frontend/src/theme.js`. `applyTheme()` publishes them as CSS custom
properties (`--c-*`, `--font-*`, `--type-*`, `--space-*`, `--radius-*`, `--z-*`,
`--motion-*`). Components read colours from theme.js only.

**Revamped (November 2026).** The tokens, the colours, the meaning of each
status colour and the type are unchanged from the original console. The ui-revamp
replaced the single long page of numbered step panels with three views (New
test, Run, History), moved mono to data only, and made every result lead with
its findings. The sections below describe the revamped system.

**Key Characteristics:**
- Graphite tonal layers (inset → page → panel → raised), separated by 1px seams. No shadows, no side tabs.
- One action accent, Signal Teal, which never means "passed".
- A fixed status palette whose meanings stay the same on every surface.
- Mono for readouts, sans for words. Tabular figures everywhere.
- Five type sizes. Hierarchy comes from weight and colour before size.
- Findings first: bugs with their payloads, then coverage, then the SLO.
- A 4px spacing scale. Gaps inside a group are smaller than gaps between groups.

## Colors

A cool graphite casing with a single teal signal, and a status palette that
works as a legend, not as decoration.

### Primary
- **Signal Teal** (`signal-teal`): actions, focus, progress and selection
  only. Used for primary buttons, the focus outline, the progress fill, text
  selection, the active step in the rail, a pressed toggle, text links and
  checkbox ticks. **It never means "passed"**; that is Pass Green.
- **Signal Teal Bright** (`signal-teal-bright`): hover for primary buttons only.
- **Signal Teal Wash** (`signal-teal-wash`): the background of a selected
  rail item or a pressed toggle.
- **On Signal** (`on-signal`): text and icons on a teal fill.

### Status (meaning only)
Each outcome has a fixed colour (`outcome` map in theme.js). It appears in the
outcome strip, failure cards, findings and the comparison table, and it means
the same thing everywhere. Each status colour has a matching `-wash` tint at
10–13% alpha for banners and badges.
- **Pass Green** (`pass-green`): Passed / Handled correctly, SLO PASS,
  backend Connected.
- **Reject Amber** (`reject-amber`): Rejected (4xx) and Rejected valid input.
- **Throttle Blue** (`throttle-blue`): Rate limited (429).
- **Fault Red** (`fault-red`): Server error (5xx), SLO FAIL, a regression
  against the baseline, errors, Backend offline.
- **Dead-Line Grey** (`dead-line-grey`): Connection failure (no answer at
  all) and Other status.
- **Leak Violet** (`leak-violet`): Accepted invalid input. A validation bug
  that slipped through, which is why it gets its own colour, distinct from
  every HTTP class.

### Chart
- **Trace Iris** (`trace-iris`) and **Trace Rose** (`trace-rose`): timeline
  series. These hues sit deliberately outside the status set, so a line never
  reads as "4xx" or "429". They are checked for colour-blind separation on the
  panel surface.
- **Graticule** (`graticule`): chart grid lines and the empty track behind
  bars and strips.

### Neutral
- **Graphite Page** (`graphite-page`): the page background.
- **Graphite Panel** (`graphite-panel`): step panels.
- **Graphite Raised** (`graphite-raised`): readouts, sub-panels, hover rows,
  disabled buttons.
- **Graphite Inset** (`graphite-inset`): inputs, code and payload blocks,
  chips. It is the one layer darker than the page, so recessed fields look
  recessed.
- **Seam** (`seam`): default borders, input strokes, table header rules, the
  border of the active panel, stat dividers.
- **Seam Subtle** (`seam-subtle`): panel borders at rest, row rules, chip
  borders, the header rule.
- **Readout White** (`readout-white`): primary text and values.
- **Caption Grey** (`caption-grey`): labels, descriptions, table headers.
- **Faint Grey** (`faint-grey`): placeholders, "Waiting" / "Not needed"
  states, percentages in legends, disabled text. It still reaches at least
  4.5:1 on every surface, including Graphite Raised.
- **Scrollbar Thumb** (`scrollbar-thumb`): thin scrollbars everywhere.

### Named Rules
**The Signal Is Not a Pass Rule.** Signal Teal marks what you can act on or
where you are. Success is always Pass Green. A finished step's ✓ is teal
because it is navigation state, not a test result.

**The Fixed Legend Rule.** A status colour means one outcome on every surface.
Never reuse a status hue for decoration, branding or emphasis, and never pick a
chart colour from the status set.

**The Name It Too Rule.** Colour is never the only carrier. Every outcome,
verdict and state is also named in text (or `aria-label`), with a mark: ✓ ✗ ● ○ –.

## Typography

**Body Font:** Barlow (400, 500, 600; with Segoe UI, system-ui fallback)
**Readout Font:** IBM Plex Mono (400, 500; with ui-monospace, Cascadia Mono fallback)

**Character:** Barlow is a slightly condensed, plain grotesque that sounds
like an engineer explaining a result. Plex Mono is the instrument's digit
display. Tabular figures (`font-variant-numeric: tabular-nums`) are on for the
body and every form control, so columns of numbers line up.

### Hierarchy
Five sizes only (`type` in theme.js).
- **Readout** (Plex Mono 400, 28px, 1.2): the big figures in the KPI row
  (requests, unexpected answers, p95, requests/s) and the SLO verdict word (600).
- **Verdict** (Barlow 600, 28px, 1.15): the findings headline of a run
  ("4 cases found bugs"). Same size as Readout, because it is a sentence, not a
  number.
- **Title** (Barlow 600, 22px, 1.2, +0.01em): the app name and the view
  titles (Results, History).
- **Heading** (Barlow 600, 16px, 1.2): step panel titles, "Summary of
  results", section headings. Finding sentences also use 16px, at 400.
- **Body** (Barlow 400/500, 14px, 1.5): UI text, button labels (600 primary,
  500 secondary), the rail labels, table data in body context. Descriptions
  are capped at 75ch.
- **Data / Meta** (12px): table cells, chips, case names, status codes and
  legend values in Plex Mono, plus captions and notes under readouts.

### Named Rules
**The Mono Means Measured Rule.** Mono is only for readouts: numbers, URLs,
IDs, payloads, status codes and case names. It is never used for labels,
headings, states or explanatory text. Table headers, field labels, step
states and the health light are all Barlow.

**The Weight Before Size Rule.** Within one panel, set hierarchy with weight
(600 vs 400) and colour (Readout White vs Caption Grey) before reaching for a
new size. There are five sizes; don't add a sixth.

**The Back Row Rule.** Verdicts and headline numbers must be readable on a
projector: Readout size, Readout White or their status colour, never Faint
Grey. Faint Grey is only for things that don't matter from across the room.

## Layout

The console is split into three views, switched by a hash router (`#/new`,
`#/run`, `#/history`) from the header's view navigation. The frame is centred,
up to 1360px wide, with 24px side padding (16px at 640px and below).

- **New test** is a two-column setup screen.
  - **Main column:** target, then ownership, then the sample request, then the
    case table. Sections are separated by a 1px Seam Subtle rule and 24px of
    space, not by boxes.
  - **Right column:** a sticky **load panel**, 340px wide, on Graphite Panel.
    It holds load, the SLO targets and Start, so Start never leaves the screen.
- **Run** is one column that opens at the top of the viewport. The run header
  shows the target, run id and status, with progress under it. The results come
  next, then a row of actions. Result blocks are 24px apart.
- **History** is a full-width table with a Compare bar above it. The comparison
  opens below the table.

Breakpoints:
- **≤1099px:** New test becomes one column, and the load panel follows the
  cases instead of sticking.
- **≤760px:** each SLO check row stacks.
- **≤640px:** the tagline hides, and the KPI row becomes a two-column grid.
- **390px:** nothing overflows the page. Wide tables scroll inside their own
  container.

Spacing uses a 4px scale (`space`: 4, 8, 12, 16, 24, 32). Table cells pad
8px × 12px. The KPI row has no box: figures are 24px apart with 1px Seam
dividers.

### Named Rules
**The Fold Rule.** The answer to "what happened?" is above the fold: Run opens
at the top, and New test's Start stays visible while the cases scroll.

**The Clamp Rule.** Every single-column grid clamps its track
(`grid-template-columns: minmax(0, 1fr)`). A no-wrap payload or URL may cut
with an ellipsis, but it never widens the page.

## Elevation & Depth

The console is flat. Depth comes only from tonal layering: Graphite Inset
(recessed) < Graphite Page < Graphite Panel < Graphite Raised (lifted), with 1px
seams at the edges. No element casts a shadow.

The z-index values are:
- `local` (1), inside components that use `isolation: isolate`;
- `sticky` (10), the skip link;
- `overlay` (20), popovers.

### Named Rules
**The No Shadow Rule.** Surfaces never cast shadows. To lift something, move it
up one graphite layer. To draw attention to it, strengthen its seam.

Inset `box-shadow` is used in two places as a selection marker, never as
elevation:
- a 1px inset ring marks the pressed segment of a segmented control;
- a 2px Signal Teal underline marks the current view in the navigation.

## Shapes

Corners are slightly softened and tighten as the element gets smaller:

| Element | Radius |
|---|---|
| Load panel | 8px |
| Inputs, buttons, sub-surfaces, SLO card, code blocks, presets | 6px |
| Chips, tags, segments, outcome strips | 4px |
| Filter chips, status chips, run pill, switches | Pill (999px) |
| Status dots | Circle |

Borders are always 1px. **No coloured side tab**: there is no thick left or
right border on any card, banner, notice or row. A verdict colours the whole
1px seam of its card instead.

Two border styles carry meaning:
- **Dashed** means "not there": untested cases, targets that are off, "not
  checked".
- **Solid** means present.

## Components

### Icons
Authored SVG, 16 × 16 viewBox, 1.75 stroke, round caps (`Icon.jsx`): check,
cross, dash, untested (a dashed circle), alert, info, help, star, play, stop,
refresh, edit, download, search, chevrons and close. Icons are always
`aria-hidden`; the text next to them carries the meaning.

### Buttons
Every state is designed: rest, hover, press, focus and disabled (`.btn` in
index.css). **One primary button per view**:
- Start (New test), with Analyze and Generate cases primary until they are
  done;
- Compare (History).

Everything else is secondary or a link.

- **Shape:** 6px corners, 8px × 16px padding, 14px Barlow, 1px border. The
  Start button is larger: 12px × 16px padding, at 16px.
- **Primary:** a Signal Teal fill with On Signal text at 600. Hover changes to
  Signal Teal Bright.
- **Secondary:** transparent with a Seam border and Readout White text at 500.
  Hover adds a Graphite Raised fill.
- **Link:** Signal Teal text; its underline appears on hover.
- **Press:** `translateY(1px)`.
- **Focus:** a 2px Signal Teal outline at a 2px offset.
- **Transitions:** 150ms.

### Segmented controls, presets and filter chips
- **Segmented control** (Flat / By category, 2xx / 4xx, Fixed load / Find
  capacity):
  - an inset track with a Seam border;
  - the pressed segment is raised (Graphite Raised) with a 1px inset ring and
    weight 600;
  - it uses `aria-pressed`.
- **Presets** (Smoke / Normal / Stress / Custom): 6px tiles. The pressed one
  has a Signal Teal border and wash.
- **Filter chips:** pills with a count in mono ("Injection 10/10"). The pressed
  one has a Signal Teal border and wash.

### Inputs, switches and errors
- **Inputs:** a Graphite Inset fill with a 1px Seam stroke and 6px corners.
  Entered values are in Plex Mono, labels in 14px Barlow 500 Caption Grey.
  `aria-invalid` turns the stroke Fault Red.
- **Switches** (SLO targets): a 32 × 18 track, Signal Teal when on. A target
  that is off shows a dashed "not checked" tag, never placeholder text in an
  empty field.
- **Errors** sit directly under the control that caused them, in Fault Red
  with an alert icon. They are linked with `aria-describedby` and announced
  with `role="alert"`. There is no page-top error banner.

### Popover
A "?" icon button (24px hit area) that opens a short explanation on Graphite
Raised with a Seam border. Esc or a click outside closes it, and focus returns
to the button. Long explanations live here or in sentences on the page, never
only in a `title` tooltip.

### Header and run pill
- **Header:** the brand and tagline, the view navigation, then the run pill
  and the health light on the right.
- **Health light:** a quiet 8px dot with "Connected" while the backend
  answers.
- **Offline:** a full-width Fault Red banner under the header replaces the
  dot, with **Try again**.
- **Run pill:** visible on every view except Run while a test is running. It
  has a Signal Teal border and wash, a pulsing dot, the elapsed seconds and a
  48px progress track, and it opens Run.

### Findings headline (signature)
The first block of a finished run:
- The verdict line is **Barlow 600 at Readout size (28px)**, with an icon:
  - **cross** in Fault Red when there are bugs;
  - **alert** in Readout White when the run is clean but incomplete;
  - **check** in Pass Green only when every case was tested and every answer
    was expected.
- A Caption Grey lede sentence follows.
- **Bug list:** on Graphite Raised. Each bug kind has its outcome swatch, a
  600-weight name and a plain-English meaning. Each case under it shows its
  name, a count, "expected 4xx, got 200", and the payload that triggered it.
- **Coverage line:** "20 of 27 cases tested", with a dashed untested icon and
  a "Show which" disclosure of dashed chips.
- **Load effects** (429, no answer) follow as separate lines, explicitly "not
  a bug".

### KPI row and outcome bar
- **Readouts:** in Plex Mono at 28px, with 14px Barlow labels above and 12px
  notes below.
- **Unexpected answers** is the one quality figure. It means total minus
  answers that matched the expected outcome.
- **Outcome bar:** segmented, 10px high, on Graphite Track, with a named
  legend of counts and percentages. Its first segment is "Expected answer".

### SLO card
A secondary card under the findings:
- Graphite Raised, with 6px corners and a 1px seam in the verdict colour
  (Pass Green or Fault Red);
- the title "Performance targets (SLO)";
- the verdict word in mono at Readout size, then "n of m targets met";
- one row per target: icon, name, target, measured value, and the state word
  ("met", "missed", "not measured").

The backend's "unexpected outcome" target is shown as **"Wrong answers to the
input"**, so it cannot be confused with the app-wide unexpected figure.

### Tables
- **Shape:** full width, collapsed borders, sticky headers on Graphite Panel.
- **Headers:** 14px Barlow 500 in Caption Grey, sortable through a header
  button with a chevron.
- **Cells:** 14px. Numbers are right-aligned in mono; case names are mono, and
  the payload sits under them in 12px mono, cut with an ellipsis.
- **Untested rows:** Caption Grey, with a dashed "Not tested: no requests"
  tag instead of an outcome bar.
- **Group rows** (By category) sit on Graphite Raised, and the total row has a
  Seam top rule.

### Timeline
Two charts: requests per second (all requests and unexpected/s) and response
time (average and p95).
- The y-axis is scaled to the data: the tidy step just above the peak, or the
  SLO line if that is higher.
- SLO targets are dashed lines.
- The ramp-up is a Graphite Raised band.
- Hover shows a readout line in mono, and a data table is available.
- Series colours are Trace Iris and Trace Rose, never status colours.
- With fewer than 5 seconds of history, the timeline is hidden.

### Case table (New test)
- **Rows:** a checkbox, the case name (mono) with its description, "what it
  sends" (the field that changed, for example `username: "' OR 1=1 --"`), and
  a 2xx / 4xx segmented control.
- **Controls:** filter chips with counts, search, and select all / none for the
  current filter.
- **Unselected rows:** Faint Grey.

### Load panel (New test)
- **Order:** mode, presets, number fields (Users, Start per second, Seconds,
  Repeat), a plain-English hint, then the **estimate** on Graphite Raised.
- **Estimate:** "Sends about 1,049 requests, about 39 per case". When cases
  may get no requests, it adds "About 2 of 27 cases may never be sent".
- **Start block:** the SLO switches, then the Start block. Its blockers are
  listed as sentences under the disabled button ("Confirm that you own the
  target…").

## Do's and Don'ts

### Do:
- **Do** take every colour, size, space, radius, z-index and duration from
  `theme.js` / the `--c-*` custom properties. Components never hard-code hex
  values.
- **Do** lead every result with its findings, then coverage, then the SLO.
- **Do** use Signal Teal for actions, focus, progress, selection and the
  current view only, and Pass Green for passing.
- **Do** pair every status colour with its name and an SVG icon, so no meaning
  depends on colour alone (WCAG 2.2 AA).
- **Do** set data (numbers, URLs, IDs, payloads, status codes, case names) in
  IBM Plex Mono, and labels, headings, states and explanations in Barlow.
- **Do** keep verdicts and headline numbers at 28px in Readout White or their
  status colour, so they read on a projector.
- **Do** put an error directly under the control that caused it.
- **Do** mark untested and "off" states with dashed outlines.
- **Do** mark every approximate value with "≈" where it is read.
- **Do** keep motion small:
  - a 6–8px rise when a view or a result arrives;
  - the progress fill;
  - pulsing run dots;
  - a short popover entrance.

  Animate only transform and colour (opacity only on popovers), and honour
  `prefers-reduced-motion`.

### Don't:
- **Don't** use mono for labels, headings or explanatory text.
- **Don't** use Signal Teal to mean success, or Reject Amber (a 4xx colour) for
  general warnings. A warning is Readout White text with an alert icon.
- **Don't** pick chart series colours from the status palette.
- **Don't** add shadows, glows, gradients or thick coloured side borders.
- **Don't** set anything a demo audience needs in Faint Grey.
- **Don't** add a sixth type size or a second accent colour.
- **Don't** explain things only in `title` tooltips; use a popover or a
  sentence.
- **Don't** load fonts or assets from external hosts. The console must render
  offline.
- **Don't** let a run with bugs or untested cases look all-green, or show an
  untested case as 0%.
