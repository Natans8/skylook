/**
 * The atlas: one sky at a time, its whole day drawn as the instrument under it, and the commands that put it in
 * the game. The engine is `sky.js` and this file is everything a person touches.
 *
 * Three surfaces and no panel: the plate (the sky, its name, its caption), the console (the day, what the sky
 * does to the world, what to copy), and four dialogs that are summoned and dismissed. The browsing of every sky
 * lives in `index.html`, so this page is for looking at one closely.
 */
import { Sky } from "./sky.js";

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
      if (param) zones.set(param, [...(zones.get(param) ?? []), spaced(zone.name)]);
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
    map?.displays.length ? `as a prop: ${map.spawn.join(" / ")}` : "",
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
  const skybox = tables.skyboxes[param.skybox];
  const others = lookup.presets.filter((p) => p.model && p.model === preset?.model).length;
  const title = preset?.title ?? `LightParams ${id}`;
  $("sky-name").textContent = title;
  document.title = `${title} — Skylook`;
  const bits = [
    preset?.model || "no model",
    preset?.where.slice(0, 2).join(", "),
    `${param.ramp.length} stop${param.ramp.length === 1 ? "" : "s"}`,
    others > 1 ? `${others} presets share this sky` : "",
    skybox && !(skybox.flags & 2) ? "no procedural stars" : "",
  ].filter(Boolean);
  // the fields are cells divided by drawn rules, and each is set as text, so a name from the tables never becomes markup
  $("sky-caption").replaceChildren(
    Object.assign(document.createElement("b"), { textContent: String(id) }),
    ...bits.map((bit) => Object.assign(document.createElement("span"), { textContent: bit })),
  );
  $("detail-text").textContent = describe(id);
  paintTake();
  paintWorld();
  bandImage = null;
  writeHash();
}

/** The commands that put this sky, or this effect, into the game. */
function paintTake() {
  const take = $("take");
  take.replaceChildren();
  const id = Sky.state.paramId;
  const preset = lookup.presets.find((p) => p.id === id);
  const param = Sky.state.light.params[id];
  const map = param ? epsilonMap()?.bySkybox.get(param.skybox) : null;
  const spell = Sky.state.screen?.spell ?? preset?.spells[0];
  if (Sky.state.screen?.spell) {
    add(take, `.aura ${Sky.state.screen.spell}`, "the effect on you", true);
    add(take, `.cast ${Sky.state.screen.spell}`, "cast the effect");
  } else if (spell) {
    add(take, `.phase shift zone skybox ${spell}`, "this zone", true);
    add(take, `.phase shift area skybox ${spell}`, "this area");
    add(take, `.aura ${spell}`, "on you");
    add(take, `.cast ${spell}`, "cast it");
  } else {
    take.append(Object.assign(document.createElement("span"), { className: "note", textContent: "no spell reaches this preset" }));
  }
  if (map?.spawn.length) add(take, map.spawn[0], "as a prop");
}

/** A button that copies one command and says the command it copied. */
function add(parent, command, label, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = command;
  if (primary) button.classList.add("primary");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      button.textContent = "copied";
      button.classList.add("done");
    } catch {
      button.textContent = "copy refused";
    }
    setTimeout(() => { button.textContent = label; button.classList.remove("done"); }, 1100);
  });
  parent.append(button);
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
let bandImage = null;
const AXIS = 13;

// the band is a contact sheet of the day: one real view per sample, each stretched across its share of the width
const SAMPLES = 48;
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;

/**
 * Draw the sky's whole day, the sun and moon arcs over it, and its LightData stops notched below.
 *
 * The columns are renders, not colours: a preset's own light says little about a sky whose brightness comes from
 * a painted dome, so each column is the view itself at that hour, one pixel wide. It is built once per preset and
 * kept, and every frame puts it back and draws the cursor over it, so the picture and the control are one thing.
 */
function drawBand() {
  const param = Sky.state.light?.params[Sky.state.paramId];
  if (!param) return;
  const width = band.clientWidth, height = band.clientHeight;
  if (width < 8 || height <= AXIS) return; // before the first layout there is nothing to draw into
  if (band.width !== width || band.height !== height) { band.width = width; band.height = height; bandImage = null; }
  if (!bandImage) {
    // a texture or a colour-grading table still arriving would draw as flat grey, so the day waits for the sky
    const pending = Sky.pending();
    if (pending.texPending || pending.loading) return;
    const sky = height - AXIS;
    const sample = document.createElement("canvas");
    sample.width = SAMPLE_WIDTH;
    sample.height = SAMPLE_HEIGHT;
    const into = sample.getContext("2d");
    const strip = document.createElement("canvas");
    strip.width = SAMPLES;
    strip.height = SAMPLE_HEIGHT;
    const onto = strip.getContext("2d");
    const now = performance.now();
    for (let i = 0; i < SAMPLES; i++) {
      const frame = Sky.renderLook(SAMPLE_WIDTH, ((i + 0.5) / SAMPLES) * DAY, now, SAMPLE_HEIGHT);
      into.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
      onto.drawImage(sample, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT, i, 0, 1, SAMPLE_HEIGHT);
    }
    bandCtx.drawImage(strip, 0, 0, SAMPLES, SAMPLE_HEIGHT, 0, 0, width, sky);

    // the sun and the moon, as high as they climb: the reason one hour of a sky looks nothing like another
    for (const [path, colour] of [[Sky.sunDirection, "#ffe28a"], [(_, time) => Sky.moonDirection(time), "#a8c6ff"]]) {
      bandCtx.beginPath();
      for (let x = 0; x < width; x++) {
        const direction = path(param, (x / width) * DAY);
        const elevation = (Math.asin(clamp(direction.z, -1, 1)) * 180) / Math.PI;
        const y = sky * (0.5 - elevation / 180);
        if (x === 0) bandCtx.moveTo(x, y); else bandCtx.lineTo(x, y);
      }
      bandCtx.strokeStyle = colour;
      bandCtx.globalAlpha = 0.55;
      bandCtx.lineWidth = 1.5;
      bandCtx.stroke();
      bandCtx.globalAlpha = 1;
    }

    // the axis: the hours, and a notch per LightData stop, which is where the sky actually turns
    bandCtx.fillStyle = "#0d0f16";
    bandCtx.fillRect(0, sky, width, AXIS);
    bandCtx.fillStyle = "#98a1b4";
    bandCtx.font = "9px 'JetBrains Mono', monospace";
    for (let hour = 0; hour <= 24; hour += 3) {
      const x = (hour / 24) * width;
      bandCtx.fillRect(x, sky, 1, hour % 6 === 0 ? 4 : 2);
      if (hour % 6 === 0 && hour < 24) bandCtx.fillText(String(hour).padStart(2, "0"), x + 3, height - 3);
    }
    bandCtx.fillStyle = "#ffffff59";
    for (const stop of param.ramp) bandCtx.fillRect((stop.time / DAY) * width, sky - 4, 1, 4);
    bandImage = bandCtx.getImageData(0, 0, width, height);
  } else {
    bandCtx.putImageData(bandImage, 0, 0);
  }

  const x = (Sky.state.time / DAY) * band.width;
  bandCtx.fillStyle = accent;
  bandCtx.fillRect(x - 1, 0, 2, band.height - AXIS);
  bandCtx.beginPath();
  bandCtx.moveTo(x - 5, 0); bandCtx.lineTo(x + 5, 0); bandCtx.lineTo(x, 6);
  bandCtx.fill();
}

let scrubbing = false;
const scrubTo = (event) => {
  const box = band.getBoundingClientRect();
  Sky.state.time = clamp(((event.clientX - box.left) / box.width) * DAY, 0, DAY - 1);
};
band.addEventListener("pointerdown", (event) => { scrubbing = true; band.setPointerCapture(event.pointerId); scrubTo(event); });
band.addEventListener("pointermove", (event) => { if (scrubbing) scrubTo(event); });
band.addEventListener("pointerup", () => { scrubbing = false; writeHash(); });

// ---------------------------------------------------------------- the interface is lit by the sky it shows

let accent = "#ffcf5c";
let lastLight = null;

/** The accent for a light: the sun's own colour by day and moonlight by night, lifted until it reads on the panel. */
function litColour(light, sunElevation) {
  const moonlight = [0.42, 0.58, 1];
  // by day the sun's own colour, or the sky's middle when the preset leaves the sun black; by night, moonlight
  const daylight = Math.max(...light.sun) > 0.08 ? light.sun : light.middle;
  const base = sunElevation > 2 ? daylight : moonlight;
  const mixed = base.map((c, i) => c * 0.72 + light.top[i] * 0.28);
  const luminance = 0.2126 * mixed[0] + 0.7152 * mixed[1] + 0.0722 * mixed[2];
  const lift = luminance > 0.004 ? Math.max(1, 0.68 / luminance) : 1;
  return mixed.map((c) => clamp(c * lift, 0, 1));
}

function applyAccent(light, sunElevation) {
  const colour = litColour(light, sunElevation);
  const hex = `#${colour.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  if (hex === accent) return;
  accent = hex;
  const luminance = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
  document.documentElement.style.setProperty("--lit", hex);
  document.documentElement.style.setProperty("--lit-ink", luminance > 0.5 ? "#14100a" : "#f4f7ff");
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
    : "None. An effect is drawn over the perspective view, so choosing one leaves the panorama.";
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
    const file = await Sky.exportLoop(loopOptions(), (what) => { exportNote.textContent = what; });
    download(file.blob, file.name);
    exportNote.textContent = `Saved, ${(file.size / 1048576).toFixed(1)} MB: ${file.note}.`;
  } catch (e) {
    exportNote.textContent = `The loop did not export: ${e.message}`;
  }
}));

// ---------------------------------------------------------------- the detail sheet

$("layers").addEventListener("change", (event) => {
  const box = event.target.closest("[data-layer]");
  if (box) Sky.state.layers[box.dataset.layer] = box.checked;
});
$("body").addEventListener("change", (event) => {
  Sky.state.body = event.target.value;
  const param = Sky.state.light.params[Sky.state.paramId];
  if (param) Sky.chooseBody(param);
});

// ---------------------------------------------------------------- looking around

const canvas = $("gl");
let drag = null;
canvas.addEventListener("pointerdown", (event) => { drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  if (Sky.state.pano) {
    // dragging the strip scrolls it, and one canvas width is one whole turn
    Sky.LOOK.yaw += ((event.clientX - drag.x) / canvas.clientWidth) * Math.PI * 2;
  } else {
    Sky.LOOK.yaw -= (event.clientX - drag.x) * 0.004;
    Sky.LOOK.pitch = clamp(Sky.LOOK.pitch + (event.clientY - drag.y) * 0.004, -1.5, 1.5);
  }
  drag = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointerup", () => { drag = null; writeHash(); });
canvas.addEventListener("wheel", (event) => {
  if (!Sky.state.pano) Sky.setFov(Sky.fov() + Math.sign(event.deltaY) * 3);
  event.preventDefault();
}, { passive: false });

// ---------------------------------------------------------------- the clock

const play = $("play");
function setPlaying(on) {
  Sky.state.playing = on;
  play.setAttribute("aria-pressed", String(on));
  play.querySelector(".glyph").textContent = on ? "❙❙" : "▶";
}
play.addEventListener("click", () => setPlaying(!Sky.state.playing));

const speedLabel = (v) => (v >= 60 ? `${(v / 60).toFixed(v >= 600 ? 0 : 1)} hours a second` : v >= 1 ? `${v.toFixed(v >= 10 ? 0 : 1)} minutes a second` : `${(v * 60).toFixed(0)} seconds a second`);
$("speed").addEventListener("input", (event) => {
  Sky.state.speed = Math.pow(10, Number(event.target.value));
  $("speed-read").value = speedLabel(Sky.state.speed);
});

// ---------------------------------------------------------------- dialogs and keys

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

const viewButton = $("toggle-view");
/** Switch between the panorama and the perspective view, from the button or the key. */
function toggleView() {
  Sky.state.pano = !Sky.state.pano;
  writeHash();
}
viewButton.addEventListener("click", toggleView);

const sheets = { effects: $("effects"), export: $("export"), detail: $("detail") };
function toggleSheet(name) {
  const sheet = sheets[name];
  for (const [other, node] of Object.entries(sheets)) if (other !== name && node.open) node.close();
  if (sheet.open) sheet.close(); else sheet.showModal();
}
$("open-effects").addEventListener("click", () => toggleSheet("effects"));
$("open-export").addEventListener("click", () => toggleSheet("export"));
$("open-detail").addEventListener("click", () => toggleSheet("detail"));

document.addEventListener("keydown", (event) => {
  const typing = event.target instanceof Element && event.target.matches("input, select, textarea");
  if (event.key === "/" && !typing) { event.preventDefault(); openFind(); return; }
  if (typing || event.metaKey || event.ctrlKey) return;
  const step = event.shiftKey ? 120 : 20;
  switch (event.key) {
    case " ": event.preventDefault(); setPlaying(!Sky.state.playing); break;
    case "ArrowLeft": Sky.state.time = (Sky.state.time - step + DAY) % DAY; break;
    case "ArrowRight": Sky.state.time = (Sky.state.time + step) % DAY; break;
    case "p": toggleView(); break;
    case "r": Sky.LOOK.yaw = 0; Sky.LOOK.pitch = 0.15; Sky.setFov(73.74); writeHash(); break;
    case "s": toggleSheet("effects"); break;
    case "e": toggleSheet("export"); break;
    case "d": toggleSheet("detail"); break;
    default: break;
  }
});

// ---------------------------------------------------------------- the address bar remembers where you are

function writeHash() {
  const parts = [`b=${Sky.state.build}`, `p=${Sky.state.paramId}`, `t=${Math.round(Sky.state.time)}`];
  if (Sky.state.screen) parts.push(`se=${Sky.state.screen.id}`);
  if (Sky.state.pano) parts.push(`yaw=${Math.round((Sky.LOOK.yaw * 180) / Math.PI)}`);
  else parts.push("view=look");
  history.replaceState(null, "", `#${parts.join("&")}`);
}

// ---------------------------------------------------------------- boot

Sky.on("build", () => {
  indexTables();
  const build = $("build");
  build.replaceChildren(...Sky.state.builds.map((b) => Object.assign(document.createElement("option"), { value: b.build, textContent: b.label, disabled: !b.exported })));
  build.value = Sky.state.build;
  const bodies = Sky.state.light.celestialBodies ?? [];
  $("body").replaceChildren(
    Object.assign(document.createElement("option"), { value: "auto", textContent: "auto, the red star unless hidden" }),
    Object.assign(document.createElement("option"), { value: "none", textContent: "none" }),
    ...bodies.map((b) => Object.assign(document.createElement("option"), { value: String(b.id), textContent: `row ${b.id}${b.id === 9 ? ", Argus" : b.id === 20 ? ", the red star" : ""}` })),
  );
  $("body").value = Sky.state.body;
  renderEffects("");
  noteEffect();
});
Sky.on("preset", () => paintPlate());
/** The sky's own height: a panorama is as tall as its aspect makes it, a perspective view takes what is left. */
function fitSky() {
  const room = window.innerHeight - parseInt(getComputedStyle(document.documentElement).getPropertyValue("--console"), 10);
  const height = Sky.state.pano ? Math.min(room, window.innerWidth / 4.0914) : room;
  document.documentElement.style.setProperty("--sky", `${Math.round(height)}px`);
  document.body.classList.toggle("panorama", Sky.state.pano);
}
window.addEventListener("resize", () => { fitSky(); bandImage = null; });

/** The waiting line and the trouble line, from any frame, drawn or not. */
function paintStatus(loading, error) {
  $("waiting").hidden = !loading;
  if (loading) $("waiting-what").textContent = loading;
  $("sky-trouble").hidden = !error;
  if (error) $("sky-trouble").textContent = error;
}
Sky.on("waiting", ({ loading, error }) => paintStatus(loading, error));

Sky.on("frame", ({ time, loading, error, light, sun }) => {
  $("clock").textContent = hhmm(time);
  viewButton.setAttribute("aria-pressed", String(!Sky.state.pano));
  fitSky();
  lastLight = light;
  applyAccent(light, (Math.asin(clamp(sun.z, -1, 1)) * 180) / Math.PI);
  drawBand();
  if (Sky.state.playing || scrubbing || !$("world").children.length) paintWorld(light);
  paintStatus(loading, error);
});

$("build").addEventListener("change", (event) => {
  // a build that fails to load leaves the last one drawn, so the select goes back to naming it
  Sky.loadBuild(event.target.value, Sky.state.paramId).catch(() => { event.target.value = Sky.state.build; });
});

const hash = Object.fromEntries(location.hash.slice(1).split("&").filter(Boolean).map((kv) => kv.split("=")));
setPlaying(false);
$("speed-read").value = speedLabel(Sky.state.speed);
$("speed").value = String(Math.log10(Sky.state.speed));
for (const box of document.querySelectorAll("#layers [data-layer]")) box.checked = Sky.state.layers[box.dataset.layer];
await Sky.boot({
  build: hash.b,
  param: hash.p ? Number(hash.p) : undefined,
  time: hash.t ? Number(hash.t) : undefined,
  yaw: hash.yaw ? Number(hash.yaw) : undefined,
  view: hash.view,
  screen: hash.se ? Number(hash.se) : undefined,
});
if (Sky.state.light) noteEffect();
