/**
 * The one rule both pages colour their accent by: a colour lifted until it reads against the dark interface, and
 * the ink that reads on top of it.
 */

const DEFAULT = { hex: "#ffcf5c", ink: "#14100a" };
const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** `rgb` in channels from 0 to 1; a colour too dark to lift keeps the default gold. */
export function readable(rgb) {
  const before = luminance(rgb);
  if (before <= 0.004) return DEFAULT;
  const lift = Math.max(1, 0.68 / before);
  const lit = rgb.map((c) => Math.min(1, Math.max(0, c * lift)));
  return {
    hex: `#${lit.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`,
    ink: luminance(lit) > 0.5 ? "#14100a" : "#f4f7ff",
  };
}
