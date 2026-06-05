/**
 * Shared status pill for the investor brief + demo pages.
 *
 * Replaces the inline `StatusPill` components that lived in
 * `/proposal/{data,competition,customers}/page.tsx`. The vocabulary is
 * canonical across the whole deck so a reader who learns what
 * "Designed" means on /proposal/strategy reads the same thing on
 * /proposal/agentforce.
 *
 * Three tones, distinguished by what kind of honesty signal the pill
 * is carrying:
 *
 *   - "real"  (green, dotted)  -> a prototype-stage capability that is
 *                                 verifiable in code today
 *                                 (Shipped / Wired in prototype /
 *                                 Today \u00b7 partial)
 *   - "mock"  (amber, dotted)  -> a capability that is committed but
 *                                 not yet wired
 *                                 (Designed / Planned / Future)
 *   - "info"  (cool, dotted)   -> a source-of-truth tag on a number,
 *                                 quote, or claim that is NOT a
 *                                 capability status
 *                                 (Estimate / Research / Target /
 *                                  Plan / Illustrative composite)
 *
 * The "info" tone is new in this refactor. Previously these tags
 * borrowed the amber "mock" tone, which conflated "this code is a
 * mock" with "this number is from outside research." Now they read
 * cleanly as three distinct categories.
 *
 * Visual styling lives in `globals.css` under
 * `.pre-brief-source-badge` / `--real` / `--mock` / `--info`.
 */

export type StatusPillStatus =
  | "shipped"
  | "prototype"
  | "partial"
  | "designed"
  | "planned"
  | "future"
  | "estimate"
  | "research"
  | "target"
  | "plan"
  | "illustrative";

export const STATUS_PILL_LABEL: Record<StatusPillStatus, string> = {
  shipped: "Shipped",
  prototype: "Wired in prototype",
  partial: "Today · partial",
  designed: "Designed",
  planned: "Planned",
  future: "Future",
  estimate: "Estimate",
  research: "Research",
  target: "Target",
  plan: "Plan",
  illustrative: "Illustrative composite"
};

const STATUS_PILL_TONE: Record<StatusPillStatus, "real" | "mock" | "info"> = {
  shipped: "real",
  prototype: "real",
  partial: "real",
  designed: "mock",
  planned: "mock",
  future: "mock",
  estimate: "info",
  research: "info",
  target: "info",
  plan: "info",
  illustrative: "info"
};

export interface StatusPillProps {
  status: StatusPillStatus;
  /**
   * Override the default label, e.g. to write "Shipped today" while
   * still using the "shipped" tone. Optional.
   */
  label?: string;
  /**
   * Extra utility styles (e.g. font-size override when used in a
   * dense table cell).
   */
  style?: React.CSSProperties;
  className?: string;
}

export function StatusPill({ status, label, style, className }: StatusPillProps) {
  const tone = STATUS_PILL_TONE[status];
  const text = label ?? STATUS_PILL_LABEL[status];
  const combinedClass = [
    "pre-brief-source-badge",
    `pre-brief-source-badge--${tone}`,
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={combinedClass} style={style}>
      {text}
    </span>
  );
}
