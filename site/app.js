/**
 * The atlas: one sky at a time, its whole day drawn as the instrument under it, and the commands that put it in
 * the game. The engine is `sky.js` and this file is everything a person touches.
 *
 * Three surfaces and no panel: the plate (the sky, its name, its caption), the console (the day, what the sky
 * does to the world, what to copy), and the sheets that are summoned and dismissed. The browsing of every sky
 * lives in `index.html`, so this page is for looking at one closely.
 */
import { Sky } from "./sky.js?v=a7140869ee";
import { commandButtons, effectCommands, listenForCommands, skyCommands } from "./commands.js?v=a7140869ee";
import { readable } from "./lit.js?v=a7140869ee";
import { EXTREME_MOTION, measureMotion, motionWarning } from "./motion.js?v=a7140869ee";

const $ = (id) => document.getElementById(id);
const DAY = Sky.DAY;
/** The Epsilon map is keyed by 9.2.7's skybox rows, which another build numbers differently, so it answers for 9.2.7 alone. */
const epsilonMap = () => (Sky.state.build === Sky.DEFAULT_BUILD ? Sky.state.map : null);
// a link pasted over this one changes only the hash, which reloads nothing; the page's own address updates use
// replaceState, which never fires this, so only a person's navigation lands here
window.addEventListener("hashchange", () => location.reload());
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hhmm = (t) => `${String(Math.floor(t / 120)).padStart(2, "0")}:${String(Math.floor((t % 120) / 2)).padStart(2, "0")}`;
const modelStem = (skybox) => (skybox ? skybox.name.split(/[\\/]/).pop().replace(/\.(mdx|m2)$/i, "") : "");
/** "BoreanTundra" is how the table spells a zone; a reader wants "Borean Tundra". */
const spaced = (name) => name.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/_/g, " ");
/** A name a plate can carry: "shadowmoon_sky01" becomes "Shadowmoon Sky01". */
const titled = (name) => spaced(name).replace(/(^|\s)([a-z])/g, (all, gap, letter) => gap + letter.toUpperCase());

// ---------------------------------------------------------------- what the tables say about a preset

/** Per-preset zone names, map names and spells, worked out once per build. */
let lookup = { zones: new Map(), maps: new Map(), spells: new Map(), presets: [] };

/** Read the build's tables into the shapes this page asks questions of. */
function indexTables() {
  const tables = Sky.state.light;
  const zones = new Map(), maps = new Map(), spells = new Map();
  const lightById = new Map(tables.lights.map((row) => [row.id, row]));
  for (const zone of tables.zoneLights ?? []) {
    for (const param of lightById.get(zone.light)?.params ?? []) {
      // several ZoneLight rows can name one place, and a caption names it once
      if (param) zones.set(param, [...new Set([...(zones.get(param) ?? []), spaced(zone.name)])]);
    }
  }
  for (const row of tables.lights) {
    const name = tables.maps[String(row.map)];
    if (!name) continue;
    for (const param of row.params) if (param) maps.set(param, [...new Set([...(maps.get(param) ?? []), name])]);
  }
  for (const [spell, param] of Object.entries(tables.spells ?? {})) {
    spells.set(param, [...(spells.get(param) ?? []), Number(spell)]);
  }
  const presets = Object.entries(tables.params).map(([id, param]) => {
    const numeric = Number(id);
    const skybox = tables.skyboxes[param.skybox];
    const where = zones.get(numeric) ?? maps.get(numeric) ?? [];
    return {
      id: numeric,
      // a zone names a sky best; without one its model is more use than the continent it happens to sit on
      title: zones.get(numeric)?.[0] ?? (skybox ? titled(modelStem(skybox)) : where[0]) ?? `LightParams ${id}`,
      model: modelStem(skybox),
      where,
      spells: spells.get(numeric) ?? [],
      text: `${id} ${modelStem(skybox)} ${where.join(" ")} ${(spells.get(numeric) ?? []).join(" ")}`.toLowerCase(),
    };
  });
  lookup = { zones, maps, spells, presets };
}

/** The names of the flags a bit field carries. */
const setBits = (bits, list) => list.filter(([bit]) => bits & bit).map(([, name]) => name);

/** Everything the current preset declares, as the plain lines the detail sheet shows. */
function describe(id) {
  const tables = Sky.state.light;
  const param = tables.params[id];
  if (!param) return "";
  const skybox = tables.skyboxes[param.skybox];
  const preset = lookup.presets.find((p) => p.id === id);
  const flags = [[1, "no darken depth"], [2, "does not inherit a skybox"], [4, "hides the sun"], [8, "hides the moon"], [16, "hides the stars"], [32, "overrides the celestial sphere"], [64, "height fog above a plane"], [128, "hides the celestial body"], [256, "overrides the sun's position"]];
  const skyFlags = [[1, "animates over the whole day"], [2, "combines with the procedural sky"], [4, "blends the procedural fog"], [8, "forces sun shafts"], [16, "drops the sun fog colour"]];
  const luts = new Set(param.ramp.map((s) => s.ColorGradingFileDataID).filter(Boolean));
  const map = epsilonMap()?.bySkybox.get(param.skybox);
  const below = belowOf.get(`${Sky.state.build}:${id}`);
  const motion = motionOf.get(`${Sky.state.build}:${id}`);
  const lines = [
    `LightParams ${id} on ${Sky.state.build}`,
    `  ${param.ramp.length} stops, glow ${param.glow}, highlight sky ${param.highlightSky}`,
    `  flags: ${setBits(param.flags, flags).join(", ") || "none"}`,
    skybox ? `LightSkybox ${param.skybox}: ${skybox.name} (file ${skybox.fid}${skybox.celestialFid ? `, celestial ${skybox.celestialFid}` : ""})` : "no skybox model, so the sky is procedural alone",
    skybox ? `  flags: ${setBits(skybox.flags, skyFlags).join(", ") || "none"}` : "",
    luts.size ? `colour grading: ${[...luts].join(", ")}` : "",
    param.sun ? `sun override: polar ${param.sun.polar}°, azimuth ${param.sun.azimuth}°` : "",
    param.shafts ? `light shafts: ${param.shafts.length} stops, which this viewer does not draw` : "",
    preset?.where.length ? `used on: ${preset.where.join(", ")}` : "no zone or map row uses it",
    preset?.spells.length ? `skybox spells: ${preset.spells.join(", ")}` : "no skybox spell reaches it",
    map?.displays.length ? `as a gob: ${map.spawn.join(" / ")}` : "",
    below ? `below the horizon: ${{ none: "fog of one colour", some: "sky worth a look", mostly: "most of the sky" }[below]}` : "",
    motion !== undefined ? `motion: ${Math.round(motion * 100)}% of the turn moves by itself` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- the plate

function paintPlate() {
  const id = Sky.state.paramId;
  const tables = Sky.state.light;
  const param = tables.params[id];
  if (!param) return;
  const preset = lookup.presets.find((p) => p.id === id);
  const title = preset?.title ?? `LightParams ${id}`;
  $("sky-name").textContent = title;
  document.title = `${title} — Skylook`;
  paintCaption();
  // the way back lands on the gallery card this sky or effect is pictured on, when the build is the gallery's
  const card = Sky.state.screen ? `effect-${Sky.state.screen.row.fullScreen}` : `sky-${param.skybox}`;
  $("back").href = Sky.state.build === Sky.DEFAULT_BUILD ? `./index.html#${card}` : "./index.html";
  $("detail-text").textContent = describe(id);
  paintTake();
  paintWorld();
  bandDirty = true;
  writeHash();
}

/** The caption's cells: the preset, its model and places, its stops, and what the sky holds below the horizon. */
function paintCaption() {
  const id = Sky.state.paramId;
  const tables = Sky.state.light;
  const param = tables.params[id];
  if (!param) return;
  const preset = lookup.presets.find((p) => p.id === id);
  const skybox = tables.skyboxes[param.skybox];
  const others = lookup.presets.filter((p) => p.model && p.model === preset?.model).length;
  const below = belowOf.get(presetKey());
  const bits = [
    preset?.model || "no model",
    preset?.where.slice(0, 2).join(", "),
    `${param.ramp.length} stop${param.ramp.length === 1 ? "" : "s"}`,
    others > 1 ? `${others} presets share this sky` : "",
    skybox && !(skybox.flags & 2) ? "no procedural stars" : "",
    below === "mostly" ? "most of it below the horizon" : below === "some" ? "sky below the horizon" : "",
  ].filter(Boolean);
  // the fields are cells divided by drawn rules, and each is set as text, so a name from the tables never becomes markup
  const cells = [
    Object.assign(document.createElement("b"), { textContent: String(id) }),
    ...bits.map((bit) => Object.assign(document.createElement("span"), { textContent: bit })),
  ];
  const extreme = (motionOf.get(presetKey()) ?? 0) >= EXTREME_MOTION;
  if (extreme) {
    const cell = Object.assign(document.createElement("span"), { className: "motion-cell" });
    cell.append(motionWarning(), "a lot of motion");
    cells.push(cell);
  }
  $("sky-caption").replaceChildren(...cells);
  motionButton.classList.toggle("extreme", extreme);
}

/** The commands that put this sky, or the screen effect over it, into the game. */
function paintTake() {
  const take = $("take");
  const id = Sky.state.paramId;
  const preset = lookup.presets.find((p) => p.id === id);
  const param = Sky.state.light.params[id];
  const spawn = param ? epsilonMap()?.bySkybox.get(param.skybox)?.spawn[0] : undefined;
  // an effect is only drawn over the perspective view, so the panorama offers the sky's own commands
  const screen = Sky.state.pano ? null : Sky.state.screen;
  const commands = screen?.spell
    ? [...effectCommands(screen.spell), ...skyCommands(undefined, spawn)]
    : skyCommands(preset?.spells[0], spawn);
  take.replaceChildren(Object.assign(document.createElement("span"), { className: "commands-label", textContent: "Copy" }));
  if (commands.length) {
    take.append(...commandButtons(commands));
  } else {
    const why = Sky.state.build === Sky.DEFAULT_BUILD ? "No spell sets this sky" : "Commands are for 9.2.7, the build Epsilon runs";
    take.append(Object.assign(document.createElement("span"), { className: "commands-none", textContent: why }));
  }
}

/** What the preset does past the sky: the water it tints, the light the ground takes, the fog and the shadow. */
function paintWorld(light = lastLight) {
  if (!light) return;
  const world = $("world");
  world.replaceChildren();
  const hex = (c) => `#${c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
  const group = (label, node, title) => {
    const wrap = document.createElement("div");
    wrap.className = "group";
    wrap.title = title;
    wrap.append(Object.assign(document.createElement("span"), { className: "label", textContent: label }), node);
    world.append(wrap);
  };
  const chip = (colour) => Object.assign(document.createElement("span"), { className: "chip", style: `background:${hex(colour)}` });
  const pair = (near, far) => {
    const wrap = document.createElement("div");
    wrap.className = "pair";
    wrap.append(chip(near), chip(far));
    return wrap;
  };
  group("river", pair(light.riverClose, light.riverFar), `river, close ${hex(light.riverClose)} and far ${hex(light.riverFar)}`);
  group("ocean", pair(light.oceanClose, light.oceanFar), `ocean, close ${hex(light.oceanClose)} and far ${hex(light.oceanFar)}`);
  group("ground", pair(light.groundAmbient, light.direct), `the ground's ambient ${hex(light.groundAmbient)} and the direct light ${hex(light.direct)}`);
  group("fog", chip(light.fog), `fog ${hex(light.fog)}, ending at ${Math.round(light.fogEnd)} yards`);
  const bar = document.createElement("span");
  bar.className = "bar";
  bar.append(Object.assign(document.createElement("i"), { style: `width:${Math.round(clamp(light.shadowOpacity, 0, 1) * 100)}%` }));
  group("shadow", bar, `shadows at ${Math.round(light.shadowOpacity * 100)}% opacity`);
}

// ---------------------------------------------------------------- the day band, which is the whole instrument

const band = $("band");
const bandCtx = band.getContext("2d");
const bandWrap = $("band-wrap");
const bandCursor = $("band-cursor");
let bandDirty = true;
let cursorAt = -1;

// the band is a contact sheet of the day: one real view per sample, each stretched across its share of the width
const SAMPLES = 48;
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;
const STOP_NOTCH = 4; // CSS px: the notch a LightData stop leaves along the band's foot
const BAND_PITCH = 0.15; // the viewer's own opening tilt, so the band frames what a first look frames

/**
 * Keep the day band current: draw the sky's day when the preset or the size changes, and move the cursor when the
 * hour does. The canvas is drawn once at the screen's own density, and the cursor and the hours are page elements
 * over it, so nothing is repainted each frame and nothing smears.
 */
function drawBand() {
  const param = Sky.state.light?.params[Sky.state.paramId];
  if (!param) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(band.clientWidth * ratio), height = Math.round(band.clientHeight * ratio);
  if (width < 8 || height < 8) return; // before the first layout there is nothing to draw into
  if (band.width !== width || band.height !== height) { band.width = width; band.height = height; bandDirty = true; }
  // a texture or a colour-grading table still arriving would draw as flat grey, so the day waits for the sky
  if (bandDirty && !Sky.pending().texPending && !Sky.pending().loading) paintBand(param, width, height, ratio);
  const at = Sky.state.time / DAY;
  if (at !== cursorAt) {
    cursorAt = at;
    bandCursor.style.left = `${(at * 100).toFixed(3)}%`;
    bandWrap.setAttribute("aria-valuenow", String(Math.round(Sky.state.time)));
    bandWrap.setAttribute("aria-valuetext", hhmm(Sky.state.time));
  }
}

/**
 * Paint the sky's whole day, the sun and the moon over it, and its LightData stops along the foot.
 *
 * The columns are renders, not colours: a preset's own light says little about a sky whose brightness comes from a
 * painted dome, so each column is the view at that hour. A sample faces the way the page does at the viewer's
 * opening tilt, about 28 degrees below the horizon to 45 above, with the ground left out: a sky zone, a cave or the
 * edge of Outland shows what the dome holds below the horizon, so the band does too. A hairline marks the horizon,
 * and the sun and the moon are drawn across the whole band, dashed while they are below it.
 */
function paintBand(param, width, height, ratio) {
  const sample = document.createElement("canvas");
  sample.width = SAMPLE_WIDTH;
  sample.height = SAMPLE_HEIGHT;
  const into = sample.getContext("2d");
  const strip = document.createElement("canvas");
  strip.width = SAMPLES;
  strip.height = SAMPLE_HEIGHT;
  const onto = strip.getContext("2d");
  const now = performance.now();
  const kept = { pitch: Sky.LOOK.pitch, fov: Sky.fov(), ground: Sky.state.layers.ground };
  Sky.setFov(Sky.DEFAULT_FOV);
  Sky.LOOK.pitch = BAND_PITCH;
  Sky.state.layers.ground = false;
  try {
    for (let i = 0; i < SAMPLES; i++) {
      const frame = Sky.renderLook(SAMPLE_WIDTH, ((i + 0.5) / SAMPLES) * DAY, now, SAMPLE_HEIGHT);
      into.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
      onto.drawImage(sample, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT, i, 0, 1, SAMPLE_HEIGHT);
    }
  } finally {
    Sky.LOOK.pitch = kept.pitch;
    Sky.setFov(kept.fov);
    Sky.state.layers.ground = kept.ground;
  }

  bandCtx.save();
  bandCtx.clearRect(0, 0, width, height);
  bandCtx.imageSmoothingEnabled = true;
  bandCtx.imageSmoothingQuality = "high";
  bandCtx.drawImage(strip, 0, 0, SAMPLES, SAMPLE_HEIGHT, 0, 0, width, height);

  // where an elevation falls in a sample: the sample is a perspective view, so its rows go by the tangent
  const halfField = Math.tan(((Sky.DEFAULT_FOV / 2) * Math.PI) / 180);
  const rowOf = (elevation) => {
    const angle = clamp((elevation * Math.PI) / 180 - BAND_PITCH, -1.55, 1.55);
    return height / 2 - (Math.tan(angle) / halfField) * (height / 2);
  };

  // the horizon, so what lies below it reads as below
  bandCtx.globalAlpha = 0.28;
  bandCtx.fillStyle = "#ffffff";
  bandCtx.fillRect(0, Math.round(rowOf(0)), width, Math.max(1, Math.round(ratio)));

  // the sun and the moon: the reason one hour of a sky looks nothing like another, dashed while below the horizon
  bandCtx.lineWidth = 1.5 * ratio;
  bandCtx.lineCap = "round";
  bandCtx.lineJoin = "round";
  bandCtx.shadowColor = "#000000aa";
  bandCtx.shadowBlur = 3 * ratio;
  for (const [path, colour] of [[Sky.sunDirection, "#ffe6a3"], [(_, time) => Sky.moonDirection(time), "#c4d8ff"]]) {
    for (const up of [true, false]) {
      bandCtx.beginPath();
      let drawing = false;
      for (let x = 0; x <= width; x += ratio) {
        const direction = path(param, (x / width) * DAY);
        const elevation = (Math.asin(clamp(direction.z, -1, 1)) * 180) / Math.PI;
        if ((elevation >= 0) !== up) { drawing = false; continue; }
        const y = rowOf(elevation);
        if (drawing) bandCtx.lineTo(x, y); else bandCtx.moveTo(x, y);
        drawing = true;
      }
      bandCtx.setLineDash(up ? [] : [3 * ratio, 3 * ratio]);
      bandCtx.strokeStyle = colour;
      bandCtx.globalAlpha = up ? 0.9 : 0.4;
      bandCtx.stroke();
    }
  }
  bandCtx.setLineDash([]);

  // a notch for each LightData stop along the foot, which is where the sky actually turns
  bandCtx.shadowBlur = 0;
  bandCtx.globalAlpha = 0.55;
  bandCtx.fillStyle = "#ffffff";
  const notchWidth = Math.max(1, Math.round(ratio));
  for (const stop of param.ramp) {
    bandCtx.fillRect(Math.round((stop.time / DAY) * width), height - STOP_NOTCH * ratio, notchWidth, STOP_NOTCH * ratio);
  }
  bandCtx.restore();
  bandDirty = false;
}

let scrubbing = false;
const scrubTo = (event) => {
  const box = bandWrap.getBoundingClientRect();
  Sky.state.time = clamp(((event.clientX - box.left) / box.width) * DAY, 0, DAY - 1);
};
bandWrap.addEventListener("pointerdown", (event) => { scrubbing = true; bandWrap.setPointerCapture(event.pointerId); scrubTo(event); });
bandWrap.addEventListener("pointermove", (event) => { if (scrubbing) scrubTo(event); });
bandWrap.addEventListener("pointerup", () => { scrubbing = false; writeHash(); });

// ---------------------------------------------------------------- what lies below the horizon

// thresholds on a lower half's edge detail and brightness spread, and on its detail against the upper half's
const FLAT_DETAIL = 0.002;
const FLAT_SPREAD = 0.03;
const MOSTLY_BELOW = 1.2;
const LOOK_DOWN = -0.6; // radians: the tilt "Look below the horizon" opens the perspective view at
/** What each measured preset holds below the horizon, "none", "some" or "mostly", keyed by build and preset. */
const belowOf = new Map();
const presetKey = () => `${Sky.state.build}:${Sky.state.paramId}`;
const groundButton = $("ground");
const groundBox = document.querySelector('#layers [data-layer="ground"]');
const lookBelow = $("look-below");
let groundChosen = false; // a person's own choice of ground outlasts every sky's default

/** The edge detail and the brightness spread of a rendered picture. */
function textureOf({ width, height, rgba }) {
  const light = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < light.length; i++) {
    light[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
    sum += light[i];
  }
  const mean = sum / light.length;
  let variance = 0, edges = 0, pairs = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      variance += (light[i] - mean) ** 2;
      if (x + 1 < width) { edges += Math.abs(light[i + 1] - light[i]); pairs++; }
      if (y + 1 < height) { edges += Math.abs(light[i + width] - light[i]); pairs++; }
    }
  }
  return { detail: edges / pairs, spread: Math.sqrt(variance / light.length) };
}

/**
 * What a sky holds below the horizon, measured from the sky itself rather than declared. With the ground left out,
 * the view is drawn looking halfway down and halfway up in four directions at three hours. A lower half with next to
 * no edge detail and little spread is fog of one colour and holds nothing; one with more detail than the upper half
 * is a sky that lies mostly below; anything between holds something worth a look.
 */
function surveyBelow() {
  const kept = { yaw: Sky.LOOK.yaw, pitch: Sky.LOOK.pitch, fov: Sky.fov(), ground: Sky.state.layers.ground };
  const below = { detail: 0, spread: 0 }, above = { detail: 0, spread: 0 };
  let samples = 0;
  const now = performance.now();
  Sky.state.layers.ground = false;
  Sky.setFov(90);
  try {
    for (const time of [DAY / 4, DAY / 2, (DAY * 3) / 4]) {
      for (let turn = 0; turn < 4; turn++) {
        Sky.LOOK.yaw = (turn * Math.PI) / 2;
        for (const [half, pitch] of [[below, -Math.PI / 4], [above, Math.PI / 4]]) {
          Sky.LOOK.pitch = pitch;
          const { detail, spread } = textureOf(Sky.renderLook(64, time, now, 64));
          half.detail += detail;
          half.spread += spread;
        }
        samples++;
      }
    }
  } finally {
    Sky.LOOK.yaw = kept.yaw;
    Sky.LOOK.pitch = kept.pitch;
    Sky.setFov(kept.fov);
    Sky.state.layers.ground = kept.ground;
  }
  if (below.detail / samples < FLAT_DETAIL && below.spread / samples < FLAT_SPREAD) return "none";
  return below.detail >= MOSTLY_BELOW * above.detail ? "mostly" : "some";
}

/** Measure a preset once its sky has arrived, and give the ground the default that sky wants, unless a person chose. */
function surveyWhenSettled() {
  if (!Sky.state.light?.params[Sky.state.paramId] || belowOf.has(presetKey())) return;
  const pending = Sky.pending();
  if (pending.texPending || pending.loading) return;
  const below = surveyBelow();
  belowOf.set(presetKey(), below);
  motionOf.set(presetKey(), measureMotion(Sky, DAY / 2));
  // a sky model knows nothing of terrain, so any sky with something below the horizon is shown with it: a floating
  // zone and a ground zone measure alike, and only a lower half of flat fog keeps the ground
  if (!groundChosen) Sky.state.layers.ground = below === "none";
  paintCaption();
  $("detail-text").textContent = describe(Sky.state.paramId);
}

/** The ground switch and the Details checkbox say whether the ground is drawn, and mark a sky with more under it. */
function paintGround() {
  const on = Sky.state.layers.ground;
  if (groundButton.getAttribute("aria-pressed") !== String(on)) groundButton.setAttribute("aria-pressed", String(on));
  if (groundBox.checked !== on) groundBox.checked = on;
  const below = belowOf.get(presetKey());
  const notable = below === "some" || below === "mostly";
  if (groundButton.classList.contains("notable") !== notable) {
    groundButton.classList.toggle("notable", notable);
    groundButton.title = notable ? "This sky holds more below the horizon, which the ground hides (g)" : "The ground under the horizon (g)";
  }
  if (lookBelow.hidden === notable) lookBelow.hidden = !notable;
}

/** Draw the ground or leave it out, by a person's own hand. */
function setGround(on) {
  Sky.state.layers.ground = on;
  groundChosen = true;
}
groundButton.addEventListener("click", () => setGround(!Sky.state.layers.ground));
lookBelow.addEventListener("click", () => {
  // the perspective view, tilted down, with the ground out of the way for this sky
  Sky.state.pano = false;
  Sky.LOOK.pitch = LOOK_DOWN;
  Sky.state.layers.ground = false;
  writeHash();
});

// ---------------------------------------------------------------- motion, and holding the sky still

/** How much of each measured preset moves by itself, from 0 to 1, keyed by build and preset. */
const motionOf = new Map();
const motionButton = $("motion");

/** Hold every animation still or let the sky move, and remember the choice for the next visit. */
function setStill(still, remember = true) {
  Sky.state.still = still;
  motionButton.setAttribute("aria-pressed", String(still));
  if (!remember) return;
  try {
    localStorage.setItem("skylook.still", still ? "1" : "0");
  } catch {
    // storage refused: the choice lasts this visit
  }
}
let rememberedStill = null;
try {
  rememberedStill = localStorage.getItem("skylook.still");
} catch {
  // storage refused: nothing was remembered
}
// without a choice of its own, a page shown to a system that asks for reduced motion starts still
setStill(rememberedStill === null ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : rememberedStill === "1", false);
motionButton.addEventListener("click", () => setStill(!Sky.state.still));

// ---------------------------------------------------------------- the interface is lit by the sky it shows

let accent = "#ffcf5c";
let lastLight = null;

/** The light the accent is taken from: the sun's own colour by day and moonlight by night, with the sky's top mixed in. */
function litColour(light, sunElevation) {
  const moonlight = [0.42, 0.58, 1];
  // by day the sun's own colour, or the sky's middle when the preset leaves the sun black; by night, moonlight
  const daylight = Math.max(...light.sun) > 0.08 ? light.sun : light.middle;
  const base = sunElevation > 2 ? daylight : moonlight;
  return base.map((c, i) => c * 0.72 + light.top[i] * 0.28);
}

function applyAccent(light, sunElevation) {
  const { hex, ink } = readable(litColour(light, sunElevation));
  if (hex === accent) return;
  accent = hex;
  document.documentElement.style.setProperty("--lit", hex);
  document.documentElement.style.setProperty("--lit-ink", ink);
}

// ---------------------------------------------------------------- finding a sky

const find = $("find");
let findRows = [], findAt = 0, findReturnTo = null;

function renderFind(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = lookup.presets.filter((p) => words.every((w) => p.text.includes(w)));
  findRows = hits.slice(0, 200);
  findAt = 0;
  const list = $("find-results");
  list.replaceChildren(...findRows.map((preset, i) => {
    const row = document.createElement("li");
    row.setAttribute("aria-selected", String(i === 0));
    row.append(
      Object.assign(document.createElement("span"), { className: "id", textContent: preset.id }),
      Object.assign(document.createElement("span"), { textContent: preset.title }),
      Object.assign(document.createElement("span"), { className: "where", textContent: preset.model }),
    );
    row.addEventListener("click", () => { select(i); commitFind(); });
    row.addEventListener("mouseenter", () => mark(i));
    return row;
  }));
  if (findRows.length) select(0);
}

function mark(i) {
  findAt = i;
  const rows = [...$("find-results").children];
  rows.forEach((row, at) => row.setAttribute("aria-selected", String(at === i)));
  rows[i]?.scrollIntoView({ block: "nearest" });
}

/** Move the highlight and show that sky at once, so the list is a preview rather than a promise. */
function select(i) {
  if (!findRows[i]) return;
  mark(i);
  void Sky.loadParam(findRows[i].id);
}

function openFind() {
  closeSheets();
  findReturnTo = Sky.state.paramId;
  $("find-input").value = "";
  renderFind("");
  find.showModal();
  $("find-input").focus();
}

function commitFind() {
  findReturnTo = null;
  find.close();
}

find.addEventListener("close", () => {
  if (findReturnTo !== null && findReturnTo !== Sky.state.paramId) void Sky.loadParam(findReturnTo);
  findReturnTo = null;
});
$("find-input").addEventListener("input", (event) => renderFind(event.target.value));
$("find-input").addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") { event.preventDefault(); select(Math.min(findAt + 1, findRows.length - 1)); }
  else if (event.key === "ArrowUp") { event.preventDefault(); select(Math.max(findAt - 1, 0)); }
  else if (event.key === "Enter") { event.preventDefault(); commitFind(); }
});
$("open-find").addEventListener("click", openFind);

// ---------------------------------------------------------------- screen effects

function renderEffects(query) {
  const tables = Sky.state.light;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const spellOf = new Map(Object.entries(tables.screenSpells ?? {}).map(([spell, id]) => [id, Number(spell)]));
  const rows = Object.entries(tables.screenEffects ?? {})
    .map(([id, row]) => ({ id: Number(id), row, spell: spellOf.get(Number(id)) ?? null }))
    .filter(({ id, row, spell }) => words.every((w) => `${id} ${row.name} ${spell ?? ""} ${EFFECT_KINDS[row.effect] ?? ""}`.toLowerCase().includes(w)))
    .slice(0, 200);
  $("effect-results").replaceChildren(...rows.map(({ id, row, spell }) => {
    const item = document.createElement("li");
    item.setAttribute("aria-selected", String(Sky.state.screen?.id === id));
    item.append(
      Object.assign(document.createElement("span"), { className: "id", textContent: id }),
      Object.assign(document.createElement("span"), { textContent: row.name }),
      Object.assign(document.createElement("span"), { className: "where", textContent: EFFECT_KINDS[row.effect] ?? `type ${row.effect}` }),
    );
    item.addEventListener("click", async () => {
      await Sky.applyScreen(id, spell);
      renderEffects($("effect-input").value);
      noteEffect();
    });
    return item;
  }));
}

const EFFECT_KINDS = { 0: "glow", 1: "death", 2: "netherworld", 3: "swirling fog", 4: "glow fade", 5: "sketch", 6: "colour grading", 7: "spectral sight", 8: "custom" };

function noteEffect() {
  const screen = Sky.state.screen;
  $("effect-note").textContent = screen
    ? `${screen.row.name}: ${EFFECT_KINDS[screen.row.effect] ?? `type ${screen.row.effect}`}${screen.spell ? `, spell ${screen.spell}` : ""}${screen.row.timeOfDay >= 0 ? `, which forces the clock to ${hhmm(screen.row.timeOfDay * 2)}` : ""}`
    : "None is drawn over this view.";
  paintTake();
  writeHash();
}

$("effect-input").addEventListener("input", (event) => renderEffects(event.target.value));
$("effect-clear").addEventListener("click", async () => { await Sky.clearScreen(); renderEffects($("effect-input").value); noteEffect(); });

// ---------------------------------------------------------------- exporting

const download = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

const exportWidth = () => Number($("export-width").value) || 1536;
const picture = () => Sky.toPng(Sky.renderView(exportWidth(), Sky.state.time));
const exportNote = $("export-note");
const exportButtons = [...$("export").querySelectorAll("button")];

/** One export at a time: every button in the sheet waits while a picture or a loop is being made. */
async function exporting(work) {
  for (const button of exportButtons) button.disabled = true;
  try {
    await work();
  } finally {
    for (const button of exportButtons) button.disabled = false;
  }
}

$("save-png").addEventListener("click", () => exporting(async () => {
  download(await picture(), `${Sky.stem()}_t${String(Math.round(Sky.state.time)).padStart(4, "0")}.png`);
  exportNote.textContent = "Saved.";
}));
$("copy-png").addEventListener("click", () => exporting(async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": await picture() })]);
    exportNote.textContent = "Copied.";
  } catch (e) {
    exportNote.textContent = `The clipboard refused the picture: ${e.message}`;
  }
}));

const loopOptions = () => ({
  width: exportWidth(),
  seconds: Number($("loop-seconds").value) || 8,
  fps: Number($("loop-fps").value) || 20,
  quality: Number($("loop-quality").value) || 80,
  format: $("loop-format").value,
  day: $("loop-day").value,
  seam: $("loop-seam").value,
});

$("save-loop").addEventListener("click", () => exporting(async () => {
  try {
    const file = await Sky.exportLoop(loopOptions(), (what) => { exportNote.textContent = `${what[0].toUpperCase()}${what.slice(1)}`; });
    download(file.blob, file.name);
    exportNote.textContent = `Saved, ${(file.size / 1048576).toFixed(1)} MB: ${file.note}.`;
  } catch (e) {
    exportNote.textContent = `The loop did not export: ${e.message}`;
  }
}));

// ---------------------------------------------------------------- the detail sheet

$("layers").addEventListener("change", (event) => {
  const box = event.target.closest("[data-layer]");
  if (box) {
    Sky.state.layers[box.dataset.layer] = box.checked;
    if (box.dataset.layer === "ground") groundChosen = true;
    bandDirty = true; // the band is drawn with the layers on screen, the ground apart
  }
});
$("body").addEventListener("change", (event) => {
  Sky.state.body = event.target.value;
  const param = Sky.state.light.params[Sky.state.paramId];
  if (param) Sky.chooseBody(param);
});

// ---------------------------------------------------------------- looking around

const canvas = $("gl");
const hint = $("drag-hint");
try {
  hint.hidden = localStorage.getItem("skylook.dragged") === "1";
} catch {
  hint.hidden = false; // storage refused: the hint shows on every visit
}

let drag = null;
canvas.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  if (!hint.hidden) {
    hint.hidden = true;
    try { localStorage.setItem("skylook.dragged", "1"); } catch { /* the hint comes back next visit */ }
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (Sky.state.pano) {
    // the strip follows the pointer, and the canvas's width is however much of the turn it shows
    Sky.LOOK.yaw -= (dx / canvas.clientWidth) * Math.PI * 2 * Sky.panoSpan();
  } else {
    // the view follows the pointer too: a pixel dragged turns it by as much as a pixel of the view spans
    const perPixel = (Sky.fov() * Math.PI) / 180 / canvas.clientHeight;
    Sky.LOOK.yaw += dx * perPixel;
    Sky.LOOK.pitch = clamp(Sky.LOOK.pitch + dy * perPixel, -1.5, 1.5);
  }
  drag = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointerup", () => { drag = null; writeHash(); });
canvas.addEventListener("pointercancel", () => { drag = null; });
canvas.addEventListener("wheel", (event) => {
  if (!Sky.state.pano) {
    Sky.setFov(Sky.fov() + Math.sign(event.deltaY) * 3);
    writeHash();
  }
  event.preventDefault();
}, { passive: false });

// ---------------------------------------------------------------- the clock

const play = $("play");
function setPlaying(on) {
  Sky.state.playing = on;
  play.setAttribute("aria-pressed", String(on));
  play.setAttribute("aria-label", on ? "Pause the day" : "Play the day");
  play.querySelector(".glyph").textContent = on ? "❙❙" : "▶";
}
play.addEventListener("click", () => setPlaying(!Sky.state.playing));

const speedLabel = (v) => (v >= 60 ? `${(v / 60).toFixed(v >= 600 ? 0 : 1)} hours a second` : v >= 1 ? `${v.toFixed(v >= 10 ? 0 : 1)} minutes a second` : `${(v * 60).toFixed(0)} seconds a second`);
$("speed").addEventListener("input", (event) => {
  Sky.state.speed = Math.pow(10, Number(event.target.value));
  $("speed-read").value = speedLabel(Sky.state.speed);
});

// ---------------------------------------------------------------- the view, the sheets and the keys

// a browser without the closedby attribute gets light dismiss by hand: a click on the backdrop lands on the dialog itself
if (!("closedBy" in HTMLDialogElement.prototype)) {
  for (const dialog of document.querySelectorAll("dialog[closedby=any]")) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const inside = box.top <= event.clientY && event.clientY <= box.bottom && box.left <= event.clientX && event.clientX <= box.right;
      if (!inside) dialog.close();
    });
  }
}

/** Show the panorama or the perspective view, from either switch or the key. */
function setView(pano) {
  Sky.state.pano = pano;
  writeHash();
}

const viewButtons = [...document.querySelectorAll("[data-view]")];
/** Every view switch on the page says which view is on, including when a screen effect turned the panorama off. */
let paintedPano = null;
function paintView() {
  if (paintedPano !== Sky.state.pano) {
    paintedPano = Sky.state.pano;
    // the commands and the address follow the view, including when a screen effect is what switched it
    paintTake();
    writeHash();
  }
  paintGround();
  for (const button of viewButtons) {
    const on = String((button.dataset.view === "pano") === Sky.state.pano);
    if (button.getAttribute("aria-pressed") !== on) button.setAttribute("aria-pressed", on);
  }
}

const sheets = { menu: $("menu"), effects: $("effects"), export: $("export"), detail: $("detail") };
const closeSheets = (except) => { for (const [name, node] of Object.entries(sheets)) if (name !== except && node.open) node.close(); };
function toggleSheet(name) {
  const sheet = sheets[name];
  closeSheets(name);
  if (sheet.open) sheet.close(); else sheet.showModal();
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const view = target?.closest("[data-view]");
  if (view) { setView(view.dataset.view === "pano"); return; }
  const sheet = target?.closest("[data-sheet]");
  if (sheet) toggleSheet(sheet.dataset.sheet);
});

// one build select, moved between the bar and the menu as the page narrows, so there is never a second to keep in step
const narrow = window.matchMedia("(max-width: 960px)");
const placeBuild = () => (narrow.matches ? $("menu-build") : $("bar-build")).append($("build"));
narrow.addEventListener("change", placeBuild);
placeBuild();

document.addEventListener("keydown", (event) => {
  const typing = event.target instanceof Element && event.target.matches("input, select, textarea");
  if (event.key === "/" && !typing) { event.preventDefault(); openFind(); return; }
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  const step = event.shiftKey ? 120 : 20;
  switch (event.key) {
    case " ": event.preventDefault(); setPlaying(!Sky.state.playing); break;
    case "ArrowLeft": Sky.state.time = (Sky.state.time - step + DAY) % DAY; break;
    case "ArrowRight": Sky.state.time = (Sky.state.time + step) % DAY; break;
    case "p": setView(!Sky.state.pano); break;
    case "g": if (!Sky.state.pano) setGround(!Sky.state.layers.ground); break;
    case "m": setStill(!Sky.state.still); break;
    case "r": Sky.LOOK.yaw = 0; Sky.LOOK.pitch = BAND_PITCH; Sky.setFov(Sky.DEFAULT_FOV); writeHash(); break;
    case "s": if (!Sky.state.pano) toggleSheet("effects"); break;
    case "e": toggleSheet("export"); break;
    case "d": toggleSheet("detail"); break;
    default: break;
  }
});

// ---------------------------------------------------------------- the address bar remembers where you are

function writeHash() {
  const parts = [`b=${Sky.state.build}`, `p=${Sky.state.paramId}`, `t=${Math.round(Sky.state.time)}`];
  // the direction is kept in both views; the tilt, the zoom and an effect only mean something in perspective
  parts.push(`yaw=${Math.round((Sky.LOOK.yaw * 180) / Math.PI)}`);
  if (!Sky.state.pano) {
    parts.push("view=look", `pitch=${Math.round((Sky.LOOK.pitch * 180) / Math.PI)}`, `fov=${Math.round(Sky.fov())}`);
    if (Sky.state.screen) parts.push(`se=${Sky.state.screen.id}`);
  }
  history.replaceState(null, "", `#${parts.join("&")}`);
}

// ---------------------------------------------------------------- how much of the page the sky takes

const TURN = Sky.PANO_ASPECT;
const PLATE_ROOM = 150; // what the name and caption under a panorama need
const WHOLE_TURN_SHARE = 0.45; // under this share of the room, the whole turn is a sliver and a window of it is shown
const NARROWEST_WINDOW = 0.2; // of the turn: narrower, and dragging through it stops reading as a panorama

/**
 * The sky's height. A perspective view takes all the room above the console. A panorama is the whole turn when
 * that is a real plate on this page, and on a narrow or tall one it is a window of the turn instead, as tall as the
 * caption leaves room for; the engine shows as much of the turn as keeps the map conformal at that shape.
 */
function fitSky() {
  const root = document.documentElement;
  const consoleHeight = $("console").offsetHeight;
  const room = window.innerHeight - consoleHeight;
  const width = window.innerWidth;
  let height = room;
  if (Sky.state.pano) {
    const whole = width / TURN;
    height = whole >= room * WHOLE_TURN_SHARE
      ? Math.min(room, whole)
      : Math.max(whole, Math.min(room - PLATE_ROOM, width / (NARROWEST_WINDOW * TURN)));
  }
  const skyPx = `${Math.round(height)}px`, consolePx = `${consoleHeight}px`;
  if (root.style.getPropertyValue("--sky") !== skyPx) root.style.setProperty("--sky", skyPx);
  if (root.style.getPropertyValue("--console") !== consolePx) root.style.setProperty("--console", consolePx);
  document.body.classList.toggle("panorama", Sky.state.pano);
}
window.addEventListener("resize", () => { fitSky(); bandDirty = true; });

// ---------------------------------------------------------------- boot

Sky.on("build", () => {
  indexTables();
  const build = $("build");
  build.replaceChildren(...Sky.state.builds.map((b) => Object.assign(document.createElement("option"), { value: b.build, textContent: b.label, disabled: !b.exported })));
  build.value = Sky.state.build;
  const bodies = Sky.state.light.celestialBodies ?? [];
  $("body").replaceChildren(
    Object.assign(document.createElement("option"), { value: "auto", textContent: "Auto, the red star unless hidden" }),
    Object.assign(document.createElement("option"), { value: "none", textContent: "None" }),
    ...bodies.map((b) => Object.assign(document.createElement("option"), { value: String(b.id), textContent: `Row ${b.id}${b.id === 9 ? ", Argus" : b.id === 20 ? ", the red star" : ""}` })),
  );
  $("body").value = Sky.state.body;
  renderEffects("");
  noteEffect();
});
Sky.on("preset", () => paintPlate());

/** The waiting line and the trouble line, from any frame, drawn or not. */
function paintStatus(loading, error) {
  $("waiting").hidden = !loading;
  if (loading) $("waiting-what").textContent = `${loading[0].toUpperCase()}${loading.slice(1)}`;
  $("sky-trouble").hidden = !error;
  if (error) $("sky-trouble").textContent = `${error[0].toUpperCase()}${error.slice(1)}`;
}
Sky.on("waiting", ({ loading, error }) => { fitSky(); paintStatus(loading, error); });

Sky.on("frame", ({ time, loading, error, light, sun }) => {
  $("clock").textContent = hhmm(time);
  paintView();
  fitSky();
  lastLight = light;
  applyAccent(light, (Math.asin(clamp(sun.z, -1, 1)) * 180) / Math.PI);
  drawBand();
  surveyWhenSettled();
  if (Sky.state.playing || scrubbing || !$("world").children.length) paintWorld(light);
  paintStatus(loading, error);
});

$("build").addEventListener("change", (event) => {
  // a build that fails to load leaves the last one drawn, so the select goes back to naming it
  Sky.loadBuild(event.target.value, Sky.state.paramId).catch(() => { event.target.value = Sky.state.build; });
});

listenForCommands();
const hash = Object.fromEntries(location.hash.slice(1).split("&").filter(Boolean).map((kv) => kv.split("=")));
setPlaying(false);
$("speed-read").value = speedLabel(Sky.state.speed);
$("speed").value = String(Math.log10(Sky.state.speed));
for (const box of document.querySelectorAll("#layers [data-layer]")) box.checked = Sky.state.layers[box.dataset.layer];
if (hash.pitch) Sky.LOOK.pitch = clamp((Number(hash.pitch) * Math.PI) / 180, -1.5, 1.5);
if (hash.fov) Sky.setFov(Number(hash.fov));
await Sky.boot({
  build: hash.b,
  param: hash.p ? Number(hash.p) : undefined,
  time: hash.t ? Number(hash.t) : undefined,
  yaw: hash.yaw ? Number(hash.yaw) : undefined,
  view: hash.view,
  screen: hash.se ? Number(hash.se) : undefined,
});
if (Sky.state.light) noteEffect();
