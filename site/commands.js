/**
 * The chat commands that put a sky or a screen effect into the game, named alike on both pages, and the one way
 * either page copies one: the button lights, and a line at the foot of the page repeats the command, which is the
 * only place a touch screen ever shows it.
 */

/** A sky's commands: the zone and area phase skies, the aura and the cast by its spell, and the gob by its display. */
export function skyCommands(spell, spawn) {
  const commands = [];
  if (spell) {
    commands.push(
      { label: "Zone sky", command: `.phase shift zone skybox ${spell}` },
      { label: "Area sky", command: `.phase shift area skybox ${spell}` },
      { label: "Aura", command: `.aura ${spell}` },
      { label: "Cast", command: `.cast ${spell}` },
    );
  }
  if (spawn) commands.push({ label: "Gob spawn", command: spawn });
  return commands;
}

/** A screen effect's commands: its spell as an aura and as a cast. */
export function effectCommands(spell) {
  return spell ? [{ label: "Aura", command: `.aura ${spell}` }, { label: "Cast", command: `.cast ${spell}` }] : [];
}

/** One button per command; `listenForCommands` handles a click on any of them. */
export function commandButtons(commands) {
  return commands.map(({ label, command }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command";
    button.textContent = label;
    button.title = command;
    button.dataset.command = command;
    return button;
  });
}

let toastTimer = 0;

/** Say something for a moment at the foot of the page; it is a status region, so a screen reader hears it too. */
export function announce(text) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = Object.assign(document.createElement("div"), { id: "toast", className: "toast" });
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.classList.add("shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("shown"), 2600);
}

/** Copy the command of any command button clicked anywhere on the page. */
export function listenForCommands() {
  document.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-command]") : null;
    if (!button) return;
    const { command } = button.dataset;
    try {
      await navigator.clipboard.writeText(command);
      button.classList.add("copied");
      setTimeout(() => button.classList.remove("copied"), 1200);
      announce(`Copied ${command}`);
    } catch {
      announce(`Copying was blocked. The command is ${command}`);
    }
  });
}
