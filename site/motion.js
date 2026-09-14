/**
 * How much a sky moves by itself: what the viewer's Pause motion is for, and what the gallery warns of.
 *
 * The measure is the noon panorama drawn twice, half a second apart, at three moments of its loops. The share of the
 * turn whose brightness changes between the two is how much of the sky moves, whatever moves it: a scrolling texture,
 * a turning dome or a flickering glow. The day's own light is held, so only the sky's animation counts. The viewer
 * measures each preset as it opens, and the gallery reads the same measure from `motion.json`, so the two agree.
 */

export const MOTION_WIDTH = 384; // px across the whole turn
export const MOTION_GAP_MS = 500;
export const MOTION_MOMENTS_MS = [1000, 7300, 19100]; // spread across loops of different lengths
export const MOTION_STEP = 3; // of 255: a smaller change in brightness is noise, not motion
// the share of the turn in motion at which a sky is marked, set in the widest gap at the top of the gallery's measures,
// where the skies people named as nauseating sit
export const EXTREME_MOTION = 0.7;

/** The share of pixels whose brightness changes between two pictures of one size. */
export function movingShare(a, b) {
  const pixels = a.width * a.height;
  let moving = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const before = 0.2126 * a.rgba[o] + 0.7152 * a.rgba[o + 1] + 0.0722 * a.rgba[o + 2];
    const after = 0.2126 * b.rgba[o] + 0.7152 * b.rgba[o + 1] + 0.0722 * b.rgba[o + 2];
    if (Math.abs(before - after) > MOTION_STEP) moving++;
  }
  return moving / pixels;
}

/** How much of a sky moves by itself, from 0 to 1, drawn through the engine's own panorama at a day time. */
export function measureMotion(sky, time) {
  let total = 0;
  for (const at of MOTION_MOMENTS_MS) {
    total += movingShare(sky.renderStrip(MOTION_WIDTH, time, at), sky.renderStrip(MOTION_WIDTH, time, at + MOTION_GAP_MS));
  }
  return total / MOTION_MOMENTS_MS.length;
}

/** Every gallery sky's measured motion, by skybox id, or null where a build has no record. */
export async function loadMotion(build) {
  try {
    const res = await fetch(`./data/gallery/${build}/motion.json`);
    if (!res.ok) return null;
    return new Map(Object.entries((await res.json()).skies));
  } catch {
    return null;
  }
}

/** The small amber mark of a sky with a lot of motion. */
export function motionWarning() {
  const mark = document.createElement("span");
  mark.className = "motion-warning";
  mark.title = "A lot of motion";
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", "A lot of motion");
  mark.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6 15.2 14.4H.8z" fill="currentColor"/><path d="M8 6.2v3.8" stroke="#07080c" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="12.1" r="1" fill="#07080c"/></svg>';
  return mark;
}
