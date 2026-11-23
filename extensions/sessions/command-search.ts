import type { ExtensionAPI, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
// Pi handles /hotkeys in the interactive client, not in pi.getCommands(). Don't advertise an absent
// command or guess the user's key bindings. The real help view lists the effective bindings.
const hotkeys = (item: AutocompleteItem) => item.value === "hotkeys" && item.description === "Show all keyboard shortcuts";
function display(item: AutocompleteItem, columns: () => number): AutocompleteItem {
  const description = hotkeys(item) ? "Ver los atajos de teclado activos" : item.description;
  // Pi's SelectList omits the description column at <=40 cells. Keep a short action hint
  // in the label there; insertion always uses the original value, not this display string.
  if (description && item.label === item.value) {
    const hint = description.replace(/^\[[^\]\n]*\]\s*/u, "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
    if (hint) return { ...item, description, get label() { return columns() <= 42 ? `${item.label} · ${hint}` : item.label; } };
  }
  return description === item.description ? item : { ...item, description };
}

/** Extend only the native editor's slash-name list. A suggestion carries the existing invokable value;
 * nothing here handles input, submits a command, changes focus, or calls Brain. */
export function commandSearch(current: AutocompleteProvider, commands: () => SlashCommandInfo[], columns = () => process.stdout.columns): AutocompleteProvider {
  return {
    triggerCharacters: current.triggerCharacters,
    async getSuggestions(lines, row, col, options) {
      const native = await current.getSuggestions(lines, row, col, options);
      const token = (lines[0] ?? "").trimStart();
      if (options.signal.aborted || options.force || row !== 0 || lines.length !== 1 || col !== lines[0].length ||
          !/^\/[\p{L}\p{M}\d-]*$/u.test(token) || (native && native.prefix !== token)) return native;
      const decorate = (i: AutocompleteItem) => display(i, columns);
      if (token === "/") return native && { ...native, items: native.items.map(decorate) };
      const query = fold(token.slice(1));
      if (query.length < 2 || native?.items.some(i => i.value === token.slice(1))) {
        return native && { ...native, items: native.items.map(decorate) };
      }

      // Ask the same provider for its current slash menu. The registry alone includes things not in
      // this view; conversely, the menu also contains templates/skills that would submit a prompt.
      const menu = await current.getSuggestions(["/"], 0, 1, options);
      if (options.signal.aborted || menu?.prefix !== "/") return native;
      const descriptions = new Map(commands().filter(c => c.source === "extension").map(c => [c.name, c.description ?? ""]));
      const seen = new Set(native?.items.map(i => i.value));
      const unique = new Set<string>(), ambiguous = new Set<string>();
      for (const i of menu.items) { if (unique.has(i.value)) ambiguous.add(i.value); unique.add(i.value); }
      const extra = menu.items.filter(i => {
        if (seen.has(i.value) || ambiguous.has(i.value) || i.value !== i.label) return false;
        const words = hotkeys(i) ? "atajos teclado teclas" : descriptions.get(i.value);
        return words && fold(words).split(/[^\p{L}\d]+/u).some(w => w.startsWith(query));
      }).sort((a,b) => a.value.localeCompare(b.value, "es"));
      // Preserve Pi's native name matching and precedence. Additional description matches do not
      // reorder it, even if the active session registers commands in a different order after reload.
      const items = [...(native?.items ?? []), ...extra].map(decorate);
      return items.length ? { prefix:token, items } : native;
    },
    applyCompletion: (...args) => current.applyCompletion(...args),
    shouldTriggerFileCompletion: (...args) => current.shouldTriggerFileCompletion?.(...args) ?? true,
  };
}

export function registerCommandSearch(pi: ExtensionAPI) {
  pi.on("session_start", (_e,ctx) => {
    if (ctx.mode === "tui") ctx.ui.addAutocompleteProvider(current => commandSearch(current, () => pi.getCommands()));
  });
}
