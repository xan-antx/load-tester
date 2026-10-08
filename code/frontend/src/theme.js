// Design tokens for the whole app. Components read colours from here only;
// index.css mirrors a few of them (CSS cannot import JS) and says so.

export const colors = {
  // Graphite elevation layers, darkest first.
  bg: "#111315",           // page
  surface: "#171A1D",      // step panels
  surfaceRaised: "#1E2226", // readouts, sub-panels
  inset: "#0D0F11",        // inputs, lists, code
  border: "#2C3237",
  borderSubtle: "#22272B",

  text: "#E3E6E8",
  textMuted: "#8D969E",
  textFaint: "#5F676E",

  // The single brand accent: actions, focus, progress, selection.
  accent: "#2DD4BF",
  accentHover: "#5EEAD4",
  accentSoft: "rgba(45, 212, 191, 0.10)",
  onAccent: "#0B1312",

  // Status colours carry meaning only (see `outcome` below).
  success: "#3FB950",      // passed
  warning: "#D29922",      // 4xx rejected
  info: "#58A6FF",         // 429 rate limited
  danger: "#F85149",       // 5xx server error / errors
  connection: "#8B949E",   // no response at all
  successSoft: "rgba(63, 185, 80, 0.12)",
  warningSoft: "rgba(210, 153, 34, 0.13)",
  infoSoft: "rgba(88, 166, 255, 0.12)",
  dangerSoft: "rgba(248, 81, 73, 0.12)",
  mutedSoft: "rgba(139, 148, 158, 0.12)",

  // Chart series: hues deliberately outside the status set (so a line never
  // reads as "4xx" or "429"), validated for colour-blind separation on the
  // panel surface.
  series1: "#9085e9",
  series2: "#d55181",
  grid: "#262B30",
  track: "#262B30",

  // Scrollbar thumb; index.css mirrors this value.
  scrollbarThumb: "#3A4148",
};

// What each request outcome looks like, used everywhere an outcome appears
// (outcome strips, failure cards, findings). Keys match failure_summary.kind.
export const outcome = {
  passed: { label: "Passed", fg: colors.success, soft: colors.successSoft },
  rejected: { label: "Rejected (4xx)", fg: colors.warning, soft: colors.warningSoft },
  rate_limited: { label: "Rate limited (429)", fg: colors.info, soft: colors.infoSoft },
  server_error: { label: "Server error (5xx)", fg: colors.danger, soft: colors.dangerSoft },
  connection: { label: "Connection failure", fg: colors.connection, soft: colors.mutedSoft },
  other: { label: "Other status", fg: colors.connection, soft: colors.mutedSoft },
};

export const OUTCOME_ORDER = ["passed", "rejected", "rate_limited", "server_error", "connection", "other"];

export const radius = {
  sm: 4,   // chips, small controls
  md: 6,   // inputs, buttons, sub-panels
  lg: 8,   // step panels
  pill: 999,
};

// Self-hosted (public/fonts, see index.css) with system fallbacks.
export const font = {
  sans: `"Barlow", "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif`,
  mono: `"IBM Plex Mono", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace`,
};

export const type = {
  title: 22,   // app name
  heading: 17, // step titles
  body: 14,
  small: 12.5,
  label: 12,   // mono labels
  readout: 26, // big numbers
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};
