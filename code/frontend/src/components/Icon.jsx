// A small authored icon set: 16 × 16 viewBox, 1.75 stroke, round caps.
// Icons are decorative (aria-hidden); the text next to them carries meaning
// (DESIGN.md, The Name It Too Rule).

const PATHS = {
  check: "M3.5 8.5l3 3 6-7",
  cross: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  dash: "M4 8h8",
  chevronDown: "M4.5 6.5L8 10l3.5-3.5",
  chevronRight: "M6.5 4.5L10 8l-3.5 3.5",
  chevronLeft: "M9.5 4.5L6 8l3.5 3.5",
  alert: "M8 2.5l6 11H2l6-11zM8 6.5v3.5M8 12v.01",
  info: "M8 14A6 6 0 108 2a6 6 0 000 12zM8 7.25V11M8 5v.01",
  help: "M8 14A6 6 0 108 2a6 6 0 000 12zM6.4 6.3a1.7 1.7 0 113 1.1c-.6.5-1.4.8-1.4 1.8M8 11.2v.01",
  star: "M8 2.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.2 4.6 13l.7-3.8L2.5 6.5l3.8-.5L8 2.5z",
  untested: "M8 13.5A5.5 5.5 0 108 2.5a5.5 5.5 0 000 11z",
  play: "M5 3.5v9l7.5-4.5L5 3.5z",
  stop: "M4.5 4.5h7v7h-7z",
  refresh: "M13 8a5 5 0 11-1.5-3.6M13 2.5v2.5h-2.5",
  edit: "M10.5 3l2.5 2.5L6 12.5H3.5V10L10.5 3z",
  download: "M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10",
  search: "M7 12A5 5 0 107 2a5 5 0 000 10zM10.6 10.6L14 14",
  close: "M4.5 4.5l7 7M11.5 4.5l-7 7",
};

export default function Icon({ name, size = 16, color = "currentColor", dashed = false, style }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dashed ? "2.2 2.2" : undefined}
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none", display: "inline-block", verticalAlign: "-0.15em", ...style }}
    >
      <path d={d} />
    </svg>
  );
}
