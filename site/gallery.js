/** The gallery page: one wide panorama per skybox model, and one card per distinct screen effect, each carrying
 * the Epsilon commands that reach it. The pictures and `index.json` are written by `gallery_batch.js`. */

import {CONDITIONS} from "./ts.gallerycards.js";

const BUILD = new URLSearchParams(location.search).get("build") || "9.2.7.45745";
const $ = (id) => document.getElementById(id);
const hhmm = (t) => `${String(Math.floor(t / 120)).padStart(2, "0")}:${String(Math.floor((t % 120) / 2)).padStart(2, "0")}`;

let index;
try {
  const res = await fetch(`./data/gallery/${BUILD}/index.json`);
  if (!res.ok) throw new Error(`${res.status}`);
  index = await res.json();
} catch {
  $("empty").textContent = `No gallery has been drawn for ${BUILD}.`;
  $("empty").hidden = false;
  throw new Error(`no gallery index for ${BUILD}`);
}
$("build").textContent = `${index.build}   ${index.skies.length} skyboxes   ${index.effects.length} effects`;
const picture = (kind, name) => `./data/gallery/${BUILD}/${kind}/${name}.${index.format || "png"}`;

/** Copy a command, and say so on the button for a moment. */
function copyButton(text, label = text) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = label; b.title = `copy ${text}`;
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.classList.add("done");
      setTimeout(() => b.classList.remove("done"), 900);
    } catch {
      b.textContent = "copy failed";
    }
  });
  return b;
}

function link(href, label) {
  const a = document.createElement("a");
  a.href = href; a.textContent = label;
  return a;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** The first picture on the page is the one a visitor waits for, so it loads at once; the rest wait to be scrolled to. */
let lead = true;
function stripImage(src, alt, width, height) {
  const img = element("img");
  img.src = src; img.alt = alt; img.width = width; img.height = height; img.decoding = "async";
  if (lead) img.fetchPriority = "high";
  else img.loading = "lazy";
  lead = false;
  return img;
}

/** A list read out for a person: the first few, then how many more there were. */
function some(names, keep = 3) {
    return names.slice(0, keep).join(", ") + (names.length > keep ? ` and ${names.length - keep} more` : "");
}

/** The maps under a headline: a couple by name, or a count once naming them stops telling a reader anything. */
function across(maps) {
    if (!maps.length) return "";
    return maps.length > 4 ? `across ${maps.length} maps` : `in ${maps.join(", ")}`;
}

/**
 * Where this sky is seen, as a headline and the fuller line beside it.
 *
 * A Light row places a sky under one of eight conditions, and only the first of them is the plain sky, so a sky
 * reached through no other slot is a storm sky or the sky of the dead rather than the sky of anywhere. A sky no
 * light reaches at all is not missing: an Epsilon spell or a screen effect is a source of its own.
 */
function where(s) {
    const when = s.conditions.includes(0) ? "" : CONDITIONS[s.conditions[0]] ?? "";
    const place = () => {
        // a sky used almost everywhere is described by how many places, since three arbitrary names say less than none
        if (s.zones.length > 6) return {head: `${s.zones.length} zones`, rest: across(s.maps)};
        if (s.zones.length) return {head: some(s.zones), rest: across(s.maps)};
        if (s.defaults.length) return {head: `the sky of ${s.defaults[0]}`, rest: s.defaults.length > 1 ? `and of ${some(s.defaults.slice(1), 2)}` : ""};
        // no ZoneLight names it, and the map it stands on is the place: for a raid or a dungeon that IS the answer,
        // and for a continent no table can say more, so neither gets a caveat nobody asked for
        if (s.maps.length > 6) return {head: `${s.maps.length} maps`, rest: ""};
        if (s.maps.length) return {head: some(s.maps), rest: ""};
        // no light places it, so the spell that sets it IS the answer, and a reader wants the number they will copy
        if (s.spells[0]) return {head: "No light places it", rest: s.lightSpells === 1 ? "a spell is the only way to it" : `${s.lightSpells} spells are the only way to it`};
        if (s.screenSpells) return {head: "No light places it", rest: s.screenSpells === 1 ? "a screen effect is the only way to it" : `${s.screenSpells} screen effects are the only way to it`};
        return {head: "Nothing reaches it", rest: ""};
    };
    const found = place();
    return {head: found.head, rest: [when, found.rest].filter(Boolean).join(", ")};
}

/** The spell a card's buttons copy, by number and by the name the game gives it. */
function spellSaid(spells, name, total = spells.length) {
    const said = total === 1 ? `spell ${spells[0]}` : `${total} spells, this one ${spells[0]}`;
    return name ? `${said}, ${name}` : said;
}

/** Everything past the places that reaches this sky, for the line under the name. */
function sources(s) {
    const said = [];
    if (s.lightSpells) said.push(spellSaid(s.spells, s.spellName, s.lightSpells));
    if (s.screenSpells) said.push(`${s.screenSpells} screen effect${s.screenSpells === 1 ? "" : "s"}`);
    // the plain sky needs no saying, and a condition already in the headline is not repeated
    const also = s.conditions.filter((c) => c > 0 && !(!s.conditions.includes(0) && c === s.conditions[0]));
    if (s.conditions.includes(0) ? also.length : also.length > 1) {
        said.push([...new Set(also.map((c) => CONDITIONS[c]))].join(", "));
    }
    return said;
}

/** The rail that runs the day: one notch per rendered hour, and the strip's clock is what it reads out. */
function scrubber(hours, at, show) {
    const box = element("div", "scrub");
    const rail = document.createElement("input");
    rail.type = "range"; rail.min = "0"; rail.max = String(hours.length - 1); rail.step = "1";
    rail.value = String(hours.indexOf(at));
    rail.setAttribute("aria-label", "the hour");
    const notches = element("div", "notches");
    for (const t of hours) notches.append(element("i", t === at ? "on" : ""));
    const move = () => {
        const i = Number(rail.value);
        show(hours[i]);
        for (const [k, notch] of [...notches.children].entries()) notch.classList.toggle("on", k === i);
    };
    rail.addEventListener("input", move);
    box.append(rail, notches);
    return box;
}

function skyCard(s) {
    const card = element("article", "card");
    const stem = s.name.split("/").pop().replace(/\.(mdx|m2)$/i, "");
    card.dataset.text = [s.name, s.zones.join(" "), s.maps.join(" "), s.spells.join(" "), s.skybox, s.param, s.spawn.join(" ")].join(" ").toLowerCase();
    if (s.error || !s.hours.length) {
        card.append(element("div", "missing", `${stem}: no picture (${s.error || "not rendered"})`));
        return card;
    }
    const noon = s.hours.includes(1440) ? 1440 : s.hours[0];

    const strip = element("div", "strip");
    const img = stripImage(picture("sky", `${s.skybox}_${noon}`), stem, 1536, 375);
    const clock = element("span", "clock", hhmm(noon));
    strip.append(img, clock);
    if (s.hours.length === 1) strip.append(element("span", "note", "the same at every hour"));
    card.append(strip);

    const bar = element("div", "bar");
    const title = element("div", "where", stem);
    title.title = s.name;
    bar.append(title);

    if (s.hours.length > 1) {
        bar.append(scrubber(s.hours, noon, (t) => {
            img.src = picture("sky", `${s.skybox}_${t}`);
            clock.textContent = hhmm(t);
        }));
    }

    const place = where(s);
    const line = element("div", "place", place.head);
    if (place.rest) line.append(" ", element("span", "when", place.rest));
    line.title = [...s.zones, ...s.maps].join("\n");
    bar.append(line);

    const said = [`LightParams ${s.param}`, `${s.params} preset${s.params === 1 ? "" : "s"}`, ...sources(s)];
    bar.append(element("div", "meta", said.join("   ")));

    const cmds = element("div", "cmds");
    const spell = s.spells[0];
    if (spell) {
        cmds.append(
            copyButton(`.phase shift area skybox ${spell}`, "area skybox"),
            copyButton(`.phase shift zone skybox ${spell}`, "zone skybox"),
            copyButton(`.aura ${spell}`, `.aura ${spell}`),
            copyButton(`.cast ${spell}`, `.cast ${spell}`),
        );
    }
    if (s.spawn[0]) cmds.append(copyButton(s.spawn[0], ".gob spawn"));
    cmds.append(link(`./sky.html#b=${index.build}&p=${s.param}&t=${noon}&yaw=${s.yaw ?? 0}`, "open"));
    bar.append(cmds);
    card.append(bar);
    return card;
}

function effectCard(e) {
    const card = element("article", "card");
    const names = [...new Set(e.effects.map((x) => x.name))];
    card.dataset.text = [names.join(" "), e.spells.join(" "), e.effects.map((x) => x.id).join(" "), e.full].join(" ").toLowerCase();
    if (e.error) {
        card.append(element("div", "missing", `${names[0]}: no picture (${e.error})`));
        return card;
    }
    const strip = element("div", "strip");
    strip.append(stripImage(picture("se", String(e.full)), names[0], 640, 360));

    const bar = element("div", "bar");
    const title = element("div", "where", names[0]);
    title.title = names.join("\n");
    if (names.length > 1) title.append(" ", element("span", "more", `and ${names.length - 1} more`));

    const said = [`FullScreenEffect ${e.full}`, `${e.effects.length} ScreenEffect row${e.effects.length === 1 ? "" : "s"}`];
    if (e.spells.length) said.push(spellSaid(e.spells, e.spellName));

    const cmds = element("div", "cmds");
    const spell = e.spells[0];
    if (spell) cmds.append(copyButton(`.aura ${spell}`, `.aura ${spell}`), copyButton(`.cast ${spell}`, `.cast ${spell}`));
    cmds.append(link(`./sky.html#b=${index.build}&p=1952&t=0&se=${e.effects[0].id}&view=look`, "open"));

    bar.append(title, element("div", "meta", said.join("   ")), cmds);
    card.append(strip, bar);
    return card;
}

const skies = $("skies"), effects = $("effects");
for (const s of index.skies) skies.append(skyCard(s));
for (const e of index.effects) effects.append(effectCard(e));

const query = $("q");
query.value = new URLSearchParams(location.search).get("q") ?? "";

/** Show the cards every word matches, and keep the words in the address so a search can be shared. */
function filter() {
  const words = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const card of [...skies.children, ...effects.children]) {
    const hit = words.every((w) => card.dataset.text.includes(w));
    card.hidden = !hit;
    if (hit) shown++;
  }
  $("count").textContent = words.length ? `${shown} shown` : "";
  $("empty").hidden = shown > 0;
  const params = new URLSearchParams(location.search);
  if (words.length) params.set("q", query.value.trim());
  else params.delete("q");
  const search = params.toString();
  history.replaceState(null, "", `${location.pathname}${search ? `?${search}` : ""}`);
}
query.addEventListener("input", filter);
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !(event.target instanceof Element && event.target.matches("input[type=search]"))) {
    event.preventDefault();
    query.focus();
  }
});
filter();
