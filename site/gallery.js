/**
 * The gallery: one wide panorama per skybox model and one picture per distinct screen effect. A picture opens the
 * viewer at the hour it shows, and a card carries the commands that put it in the game. The pictures and
 * `index.json` are written by `gallery_batch.js`, and `colours.json`, what colours each picture holds, by
 * `gallery_colours.py`.
 */

import {CONDITIONS} from "./ts.gallerycards.js?v=2b611090a8";
import {commandButtons, effectCommands, listenForCommands, skyCommands} from "./commands.js?v=2b611090a8";
import {readable} from "./lit.js?v=2b611090a8";
import {EXTREME_MOTION, loadMotion, motionWarning} from "./motion.js?v=2b611090a8";

const params = new URLSearchParams(location.search);
const BUILD = params.get("build") || "9.2.7.45745";
const $ = (id) => document.getElementById(id);
const hhmm = (t) => `${String(Math.floor(t / 120)).padStart(2, "0")}:${String(Math.floor((t % 120) / 2)).padStart(2, "0")}`;

const panels = {
    skies: {tab: $("tab-skies"), panel: $("skies-panel"), list: $("skies"), count: $("n-skies"), empty: $("skies-empty"), noun: "sky"},
    effects: {tab: $("tab-effects"), panel: $("effects-panel"), list: $("effects"), count: $("n-effects"), empty: $("effects-empty"), noun: "screen effect"},
};

function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

let index;
try {
    const res = await fetch(`./data/gallery/${BUILD}/index.json`);
    if (!res.ok) throw new Error(`${res.status}`);
    index = await res.json();
} catch {
    for (const p of Object.values(panels)) {
        p.empty.replaceChildren(element("p", "", `No gallery has been drawn for ${BUILD}.`));
        p.empty.hidden = false;
    }
    throw new Error(`no gallery index for ${BUILD}`);
}

/** What colours each picture holds, as a percentage per swatch, or null where a build has no record. */
async function loadColours(build) {
    try {
        const res = await fetch(`./data/gallery/${build}/colours.json`);
        if (!res.ok) return null;
        const record = await res.json();
        return {...record, index: new Map(record.colours.map((c, k) => [c.name, k]))};
    } catch {
        return null;
    }
}

// how much each sky moves by itself and what colours it holds, each measured once for the whole gallery; a gallery
// without a record warns of nothing and finds nothing by colour
const [motion, colours] = await Promise.all([loadMotion(BUILD), loadColours(BUILD)]);
const picture = (kind, name) => `./data/gallery/${BUILD}/${kind}/${name}.${index.format || "png"}`;
const inViewer = (hash) => `./sky.html#b=${index.build}&${hash}`;

// ---------------------------------------------------------------- each card is lit by its own sky

const sampler = document.createElement("canvas");
sampler.width = 32;
sampler.height = 8;
const sampling = sampler.getContext("2d", {willReadFrequently: true});

/**
 * Give a card the accent of its own picture. A sky's character is its bright, coloured part rather than its
 * average, which is usually a muddy blue-grey, so the most colourful and brightest quarter of the samples is what
 * is averaged and then lifted until it reads.
 */
function lightCard(card, img) {
    try {
        sampling.drawImage(img, 0, 0, sampler.width, sampler.height);
        const data = sampling.getImageData(0, 0, sampler.width, sampler.height).data;
        const samples = [];
        for (let i = 0; i < data.length; i += 4) {
            const c = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
            const high = Math.max(...c), low = Math.min(...c);
            samples.push({c, score: (high > 0 ? (high - low) / high : 0) * 0.6 + high * 0.4});
        }
        samples.sort((a, b) => b.score - a.score);
        const top = samples.slice(0, Math.max(1, samples.length >> 2));
        const mean = [0, 1, 2].map((k) => top.reduce((sum, s) => sum + s.c[k], 0) / top.length);
        const {hex, ink} = readable(mean);
        card.style.setProperty("--lit", hex);
        card.style.setProperty("--lit-ink", ink);
    } catch {
        // a picture that cannot be read keeps the default accent
    }
}

// ---------------------------------------------------------------- the parts of a card

/** The picture that opens the viewer. The first on the page loads at once; every other waits to be scrolled near. */
let lead = true;
function shot(href, label, src, width, height) {
    const link = element("a", "shot");
    link.href = href;
    link.setAttribute("aria-label", label);
    const img = element("img");
    img.src = src; img.alt = ""; img.width = width; img.height = height; img.decoding = "async";
    if (lead) img.fetchPriority = "high";
    else img.loading = "lazy";
    lead = false;
    link.append(img, element("span", "open", "Open in viewer"));
    return {link, img};
}

/** The fields under a name, as cells divided by drawn rules. */
function meta(fields) {
    const line = element("p", "meta");
    line.append(...fields.map((field) => element("span", "", field)));
    return line;
}

function commandRow(commands) {
    const row = element("div", "commands");
    row.append(element("span", "commands-label", "Copy"), ...commandButtons(commands));
    return row;
}

/**
 * The rail that runs the day: a labelled notch per hour drawn, and the clock on the picture reads it out. `turn`
 * moves it to an hour from outside, as a colour search does.
 */
function hourRail(hours, at, show) {
    const rail = element("div", "rail");
    const track = element("div", "track");
    const input = document.createElement("input");
    input.type = "range"; input.min = "0"; input.max = String(hours.length - 1); input.step = "1";
    input.value = String(hours.indexOf(at));
    input.setAttribute("aria-label", "Hour of the day");
    input.setAttribute("aria-valuetext", hhmm(at));
    const notches = element("div", "notches");
    const labels = element("div", "hours");
    labels.setAttribute("aria-hidden", "true");
    for (const t of hours) {
        notches.append(element("i", t === at ? "on" : ""));
        labels.append(element("span", t === at ? "on" : "", hhmm(t).slice(0, 2)));
    }
    const select = (i) => {
        input.value = String(i);
        input.setAttribute("aria-valuetext", hhmm(hours[i]));
        for (const row of [notches, labels]) {
            for (const [k, mark] of [...row.children].entries()) mark.classList.toggle("on", k === i);
        }
        show(hours[i]);
    };
    input.addEventListener("input", () => select(Number(input.value)));
    track.append(input, notches);
    rail.append(track, labels);
    return {rail, input, turn: (t) => select(hours.indexOf(t))};
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

// ---------------------------------------------------------------- the cards

/**
 * What a colour search reads off each card: the colours of every picture it has, by hour, the way to turn its rail,
 * the hour it opens at, and whether a search turned it away from there.
 */
const shades = new Map();

function skyCard(s) {
    const stem = s.name.split("/").pop().replace(/\.(mdx|m2)$/i, "");
    const card = element("article", "card");
    card.id = `sky-${s.skybox}`;
    card.dataset.text = [s.name, s.zones.join(" "), s.maps.join(" "), s.spells.join(" "), s.skybox, s.param, s.spawn.join(" ")].join(" ").toLowerCase();
    if (s.error || !s.hours.length) {
        card.append(element("div", "missing", `${stem}: no picture (${s.error || "not rendered"})`));
        return card;
    }
    const noon = s.hours.includes(1440) ? 1440 : s.hours[0];
    const at = (t) => inViewer(`p=${s.param}&t=${t}&yaw=${s.yaw ?? 0}`);
    const {link, img} = shot(at(noon), `Open ${stem} in the viewer`, picture("sky", `${s.skybox}_${noon}`), 1536, 375);
    img.addEventListener("load", () => lightCard(card, img));
    const clock = element("span", "clock", hhmm(noon));
    link.append(clock);
    if (s.hours.length === 1) link.append(element("span", "flag", "Same at every hour"));

    const info = element("div", "info");
    const name = element("h3", "name", stem);
    name.title = s.name;
    if ((motion?.get(String(s.skybox)) ?? 0) >= EXTREME_MOTION) {
        name.append(motionWarning());
        card.dataset.text += " motion";
    }
    info.append(name);
    const shade = {byHour: colours?.skies[s.skybox], home: noon, turned: false};
    shades.set(card, shade);
    if (s.hours.length > 1) {
        const {rail, input, turn} = hourRail(s.hours, noon, (t) => {
            img.src = picture("sky", `${s.skybox}_${t}`);
            clock.textContent = hhmm(t);
            link.href = at(t);
        });
        // an hour the reader picks is theirs, and ending the search leaves it where they put it
        input.addEventListener("input", () => { shade.turned = false; });
        shade.turn = turn;
        info.append(rail);
    }
    const place = where(s);
    const line = element("p", "place", place.head);
    if (place.rest) line.append(" ", element("span", "when", place.rest));
    line.title = [...s.zones, ...s.maps].join("\n");
    info.append(line, meta([`LightParams ${s.param}`, `${s.params} preset${s.params === 1 ? "" : "s"}`, ...sources(s)]));
    const commands = skyCommands(s.spells[0], s.spawn[0]);
    if (commands.length) info.append(commandRow(commands));
    card.append(link, info);
    return card;
}

function effectCard(e) {
    const names = [...new Set(e.effects.map((x) => x.name))];
    const card = element("article", "card");
    card.id = `effect-${e.full}`;
    card.dataset.text = [names.join(" "), e.spells.join(" "), e.effects.map((x) => x.id).join(" "), e.full].join(" ").toLowerCase();
    if (e.error) {
        card.append(element("div", "missing", `${names[0]}: no picture (${e.error})`));
        return card;
    }
    const shares = colours?.effects[e.full];
    shades.set(card, {byHour: shares && {0: shares}});
    const {link, img} = shot(inViewer(`p=1952&t=0&se=${e.effects[0].id}&view=look`), `Open ${names[0]} in the viewer`, picture("se", String(e.full)), 640, 360);
    img.addEventListener("load", () => lightCard(card, img));

    const info = element("div", "info");
    const name = element("h3", "name", names[0]);
    name.title = names.join("\n");
    if (names.length > 1) name.append(" ", element("span", "more", `and ${names.length - 1} more`));
    const said = [`FullScreenEffect ${e.full}`, `${e.effects.length} ScreenEffect row${e.effects.length === 1 ? "" : "s"}`];
    if (e.spells.length) said.push(spellSaid(e.spells, e.spellName));
    info.append(name, meta(said));
    const commands = effectCommands(e.spells[0]);
    if (commands.length) info.append(commandRow(commands));
    card.append(link, info);
    return card;
}

for (const s of index.skies) panels.skies.list.append(skyCard(s));
for (const e of index.effects) panels.effects.list.append(effectCard(e));
// the gallery's own order, which a colour search rearranges and ending it restores
for (const p of Object.values(panels)) p.cards = [...p.list.children];

// ---------------------------------------------------------------- tabs, search and the address

const query = $("q");
query.value = params.get("q") ?? "";
const arrival = location.hash.match(/^#(sky|effect)-(\d+)$/);
let current = arrival ? (arrival[1] === "sky" ? "skies" : "effects") : params.get("tab") === "effects" ? "effects" : "skies";

/** Keep the tab and the words in the address, so a search can be shared and a reload lands where it was. */
function writeAddress() {
    const next = new URLSearchParams(location.search);
    const words = query.value.trim();
    if (words) next.set("q", words);
    else next.delete("q");
    if (current === "effects") next.set("tab", "effects");
    else next.delete("tab");
    const search = next.toString();
    history.replaceState(null, "", `${location.pathname}${search ? `?${search}` : ""}`);
}

/** Show one tab's panel. The other keeps its count, so a search that only matches over there still says so. */
function showTab(name, {focus = false, write = true} = {}) {
    current = name;
    for (const [key, p] of Object.entries(panels)) {
        const on = key === name;
        p.tab.setAttribute("aria-selected", String(on));
        p.tab.tabIndex = on ? 0 : -1;
        p.panel.hidden = !on;
    }
    if (focus) panels[name].tab.focus();
    if (write) writeAddress();
}

/**
 * The hour of a card that holds the most of every colour asked, and how much: the least of those colours' shares
 * there. Null where no hour holds all of them at the record's cut.
 */
function strongest(byHour, asked) {
    let best = null;
    for (const [hour, shares] of Object.entries(byHour ?? {})) {
        const score = Math.min(...asked.map((k) => shares[k]));
        if (score >= colours.match && (!best || score > best.score)) best = {hour: Number(hour), score};
    }
    return best;
}

/**
 * Show the cards every word matches, count them per tab, and give a tab with none a way out.
 *
 * A whole word naming a swatch asks for that colour, so "darkshore" still finds Darkshore. A colour turns each card it
 * finds to the hour holding the most of it and puts the cards holding the most first; ending the search puts back
 * the gallery's order and every hour the search moved.
 */
function filter({write = true} = {}) {
    const typed = query.value.trim();
    const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
    const isColour = (w) => colours?.index.has(w) ?? false;
    const asked = words.filter(isColour).map((w) => colours.index.get(w));
    const text = words.filter((w) => !isColour(w));
    for (const p of Object.values(panels)) {
        let shown = 0;
        const found = [];
        for (const card of p.cards) {
            const shade = shades.get(card);
            const best = asked.length ? strongest(shade?.byHour, asked) : null;
            const hit = text.every((w) => card.dataset.text.includes(w)) && (!asked.length || best !== null);
            card.hidden = !hit;
            if (hit) shown++;
            if (hit && best && shade.turn) {
                shade.turn(best.hour);
                shade.turned = best.hour !== shade.home;
            } else if (!asked.length && shade?.turned) {
                shade.turn(shade.home);
                shade.turned = false;
            }
            found.push({card, score: best?.score ?? 0});
        }
        const order = asked.length ? found.sort((a, b) => b.score - a.score).map((f) => f.card) : p.cards;
        if (order.some((card, k) => p.list.children[k] !== card)) p.list.append(...order);
        p.count.textContent = String(shown);
        p.empty.hidden = shown > 0;
        if (shown) continue;
        p.empty.replaceChildren(element("p", "", typed ? `No ${p.noun} matches “${typed}”.` : `There is no ${p.noun} to show.`));
        if (typed) {
            const clear = element("button", "", "Clear the search");
            clear.type = "button";
            clear.addEventListener("click", () => { query.value = ""; filter(); query.focus(); });
            p.empty.append(clear);
        }
    }
    for (const swatch of swatches) swatch.setAttribute("aria-pressed", String(words.includes(swatch.dataset.colour)));
    if (write) writeAddress();
}

/** A swatch puts its colour's word in the search or takes it out, so a colour search is shared like any other. */
const swatches = (colours?.colours ?? []).map(({name, swatch}) => {
    const button = element("button", "swatch");
    button.type = "button";
    button.dataset.colour = name;
    button.style.setProperty("--swatch", swatch);
    button.title = name[0].toUpperCase() + name.slice(1);
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
        const words = query.value.trim().split(/\s+/).filter(Boolean);
        const at = words.findIndex((w) => w.toLowerCase() === name);
        if (at >= 0) words.splice(at, 1);
        else words.push(name);
        query.value = words.join(" ");
        filter();
    });
    return button;
});
if (swatches.length) {
    $("swatches").append(...swatches);
    $("swatches").hidden = false;
}

for (const [name, p] of Object.entries(panels)) p.tab.addEventListener("click", () => showTab(name));
panels.skies.tab.parentElement.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    showTab(current === "skies" ? "effects" : "skies", {focus: true});
});
query.addEventListener("input", () => filter());
document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || (event.target instanceof Element && event.target.matches("input, textarea, select"))) return;
    event.preventDefault();
    query.focus();
});

listenForCommands();
filter({write: false});
showTab(current, {write: false});

// arriving back from the viewer lands on the card it was opened from
if (arrival) {
    const card = $(`${arrival[1]}-${arrival[2]}`);
    if (card && !card.hidden) {
        card.scrollIntoView({block: "center"});
        card.classList.add("arrived");
        setTimeout(() => card.classList.remove("arrived"), 2200);
    }
}
