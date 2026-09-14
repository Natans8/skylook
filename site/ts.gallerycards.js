// ts/gallerycards.ts
var HOURS = [0, 480, 960, 1440, 1920, 2400];
var NOON = [1440];
var PITCH = 20;
var CONDITIONS = ["", "underwater", "in a storm", "underwater in a storm", "while you are dead", "in another state", "in another state", "in another state"];
var spaced = (name) => name.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/_/g, " ");
function placesOf(tables, lightById, params) {
  const conditions = /* @__PURE__ */ new Set();
  for (const row of tables.lights) for (const [slot, p] of row.params.entries()) if (params.includes(p)) conditions.add(slot);
  const plain = conditions.has(0);
  const reaches = (row) => !!row && row.params.some((p, slot) => params.includes(p) && (!plain || slot === 0));
  const zones = /* @__PURE__ */ new Set(), maps = /* @__PURE__ */ new Set(), defaults = /* @__PURE__ */ new Set();
  for (const zone of tables.zoneLights) if (reaches(lightById.get(zone.light))) zones.add(spaced(zone.name));
  for (const row of tables.lights) {
    if (!reaches(row)) continue;
    const name = tables.maps[String(row.map)] ?? `map ${row.map}`;
    maps.add(name);
    if (!row.pos.some((c) => c !== 0) && !row.falloff.some((r) => r > 0)) defaults.add(name);
  }
  return { zones: [...zones], maps: [...maps], defaults: [...defaults], conditions: [...conditions].sort((a, b) => a - b) };
}
function representative(tables, sb) {
  const uses = /* @__PURE__ */ new Map();
  for (const row of tables.lights) for (const p of row.params) if (sb.params.includes(p)) uses.set(p, (uses.get(p) ?? 0) + 1);
  const spellParams = new Set(sb.lightSpells.map((s) => tables.spells[String(s)]));
  return [...sb.params].sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || Number(spellParams.has(b)) - Number(spellParams.has(a)) || a - b)[0];
}
function flatRamp(tables, paramId) {
  const ramp = tables.params[String(paramId)].ramp;
  const keys = ["SkyTopColor", "SkyMiddleColor", "SkyBand1Color", "SkyBand2Color", "SkySmogColor", "SkyFogColor", "SunColor", "CloudDensity"];
  return ramp.every((s) => keys.every((k) => s[k] === ramp[0][k]));
}
var daySyncedTrack = (t) => !!t && t.gseq < 0 && (t.seqs[0]?.t.length ?? 0) > 1;
function daySynced(model) {
  return model.bones.some((b) => daySyncedTrack(b.translation) || daySyncedTrack(b.rotation) || daySyncedTrack(b.scale)) || model.textureTransforms.some((x) => daySyncedTrack(x.translation) || daySyncedTrack(x.rotation) || daySyncedTrack(x.scale)) || model.colors.some((c) => daySyncedTrack(c.color) || daySyncedTrack(c.alpha)) || model.textureWeights.some(daySyncedTrack);
}
function hoursFor(card, model) {
  if (!card.flat) return HOURS;
  const animated = (card.flags & 1) !== 0 && !!model && daySynced(model);
  return animated ? HOURS : NOON;
}
function planSkies(tables, epsilon) {
  const lightById = new Map(tables.lights.map((row) => [row.id, row]));
  return epsilon.skyboxes.filter((s) => s.params.length).map((sb) => {
    const param = representative(tables, sb);
    const spells = sb.lightSpells.filter((s) => tables.spells[String(s)] === param);
    return {
      skybox: sb.skybox,
      name: sb.name.replace(/\\/g, "/"),
      fid: sb.fid,
      flags: sb.flags,
      param,
      params: sb.params.length,
      spells: spells.length ? spells : sb.lightSpells.slice(0, 1),
      lightSpells: sb.lightSpells.length,
      spellName: tables.spellNames[String((spells.length ? spells : sb.lightSpells)[0])] ?? "",
      spawn: sb.spawn,
      screenSpells: sb.screenSpells.length,
      ...placesOf(tables, lightById, sb.params),
      flat: flatRamp(tables, param),
      hours: [],
      error: ""
    };
  });
}
function planEffects(tables) {
  const byFull = /* @__PURE__ */ new Map();
  for (const [id, se] of Object.entries(tables.screenEffects)) {
    if (se.effect === 8) byFull.set(se.fullScreen, [...byFull.get(se.fullScreen) ?? [], { id: Number(id), name: se.name }]);
  }
  const spellOf = /* @__PURE__ */ new Map();
  for (const [spell, se] of Object.entries(tables.screenSpells)) spellOf.set(se, Number(spell));
  return [...byFull].map(([full, effects]) => {
    const spells = effects.map((r) => spellOf.get(r.id)).filter((s) => s !== void 0);
    return {
      full,
      effects,
      spells,
      spellName: tables.spellNames[String(spells[0])] ?? "",
      // a row may name a FullScreenEffect the tables do not hold, which is worth saying rather than drawing black
      error: tables.fullScreenEffects[String(full)] ? "" : `it names FullScreenEffect ${full}, which the tables do not hold`
    };
  });
}
export {
  CONDITIONS,
  HOURS,
  NOON,
  PITCH,
  daySynced,
  hoursFor,
  planEffects,
  planSkies
};
