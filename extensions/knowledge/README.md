# Brain project knowledge

This extension consults canonical project notes on demand. It does not replace `ss_memory_read` / `ss_memory_save`, inject all notes into context, persist notes as a second authority, or traverse links. Pi may retain a tool result or write input in its ordinary session transcript; that transcript is not authoritative. Do not use these tools for secrets or for personal notes.

## Principal Project and additional sources

Use a compatible Brain build with the `brain projects` and `brain notes` JSON endpoints. Pi starts that executable directly using `BRAIN_BIN` or `brain` on PATH and Brain's existing configured vault. There is no installation, vault scan outside the Project catalog, or configuration repair.

- **`/ss-project`** selects an active Project or creates and links a new one in the exact working directory. This is an interactive user command, not a model tool or a permission grant from peer activity. One approval covers the displayed source/destination, Memory association, and principal Knowledge access. Brain owns creation, destination and the unified `.brain.toml`, using the exact observed baseline. Both Memory tools must be enabled in Pi; the two extensions remain separate. An existing Memory keeps its ID and history; an unbound context creates no empty Memory. A partial receipt distinguishes a published Project document, a reserved folder without a confirmed document and a new `notas/` folder for an existing Project. It does not confirm the binding. Inspect the state before another explicit operation; do not retry creation.
- New Projects get a Markdown document named exactly after the approved Project title (for example, `StelaShell.md`) and `notas/`. Brain rejects titles that are not portable filenames instead of silently changing them. Pi does not offer confirmation if Brain proposes a filename that differs from the title. Existing filenames remain supported and are not migrated. Pi suggests the open folder name. **Generate draft** is an explicit optional model call: the selected model provider receives bounded excerpts from the current Memory and its own History through Brain (when available), plus the title and optional operator description. No other Memory or chat is read. You can write the draft yourself instead; the editable preview precedes the single **Crear y vincular** confirmation. Use Spanish prose with `Summary`, `Objective`, `Scope`, and optional `References` headings. Brain validates the confirmed body. Selecting an existing Project never rewrites its document.
- **`/ss-knowledge`** shows the fixed principal and active Projects available as additional **read-only** sources. Toggle several, then use **Aplicar**; **Restablecer** immediately leaves only the principal, and **Cancelar** leaves preferences unchanged. Preferences contain only selected Project IDs, stored in the Pi profile per working directory, principal and observed Brain configuration, not in Git. Configuration changes can require selecting sources again; a config stamp is not an atomic vault identity. Archived or missing Projects are not offered as effective sources. It does not change the principal or import any other Project's Memory.
- **`ss_knowledge_sources`** shows the enabled sources, not the whole catalog. `ss_knowledge_list` / `ss_knowledge_read` use the principal without arguments for its identity; passing an additional `project_id` is allowed only for a currently enabled active source. Results from an additional source name its Project. Writes always go to the principal, and additional reads never count as write baselines.
- Confirming a principal through `/ss-project` enables its Knowledge write permission in Brain by default. Pi still requires the corresponding write tool to be active and genuine local activity; the menu does not change the active tool set or bypass permission hooks. A project-trust restriction, stale baseline, partial receipt or uncertain publication is not approval to retry or replace an identity.

The select-existing operation requires Brain to match `expected_project` (the exact Project ID, title and path shown to the operator) in addition to the context baseline before it writes. The baseline includes Brain's observed canonical vault directory and stays private to the host and Brain; it is neither a destination input nor drafting context. No fallback submits a bind without this guard. A Brain build that does not implement the updated contract is not sufficient for that menu.

## Legacy setup (still supported)

For a Brain build or context using only the older Notes binding, an operator can provision the ignored `.brain-notes.toml` in the exact working directory. Merely reading it does not migrate anything:

```toml
binding_version = 1
project_id = "<actual Brain Project UUID>"
project_path = "01-proyectos/<folder>/<Project>.md"
allow_write = false
```

Use the actual Project identity, not a Memory ID. The Project has its own `notas/` directory, with the project notes directly inside it. Brain checks scope; note either belongs to that directory or is not addressable by the endpoint. No parent binding lookup, unscoped Note search, arbitrary path, or model-provided project or vault selection. A change through `/ss-project` invalidates stale tool state. After changing a marker outside this session, start a fresh session to select the new scope. Activate each extension through one route only.

- **Read:** `ss_knowledge_list` lists note titles and IDs; `ss_knowledge_read` opens one note by ID. Read after genuine local input or live authenticated PRIMARY activity; helpers are excluded.
- **Write:** both Brain's effective permission on the principal and activation of the relevant Pi tool are required. Legacy `allow_write` retains its explicit value. The Pi write tools are inactive by default and do not take peer activity as a write grant. `ss_knowledge_create` requires a current list so existing notes can be checked for a canonical home. New notes use the exact portable title as the filename (for example, `Naming conventions.md`). Brain keeps the UUID as the internal identity and adds a `project_link` property for Obsidian pointing to the principal Project. The link is not part of the returned body and does not grant access. StelaShell requires a Brain version with named, linked creation and never retries an incompatible request in the old UUID-file format. Legacy notes remain readable by ID; they are not migrated automatically.
- `ss_knowledge_update` requires a fresh read in the session. The exact baseline stays in host memory; only the body is replaced, not the filename or the Project link. The update can fail with `conflict` if the backing note changed.
- `ss_knowledge_rename` takes a principal note's `note_id` and exact new `title`. It requires explicit authorization for that rename, activation of the tool, and a fresh principal read. The host supplies the exact baseline privately. This needs a Brain build supporting the `rename` operation; `unsupported` never falls back to creating a note or editing vault files. The operation is intended to change the title and Markdown filename while preserving the UUID, body and Project link. It does not rewrite incoming links by name or path.
- After `save_unconfirmed` or a `partial` rename, stop writes. A retained rename intent blocks ordinary Notes operations in that Project. Brain's read-only `inspect_rename` operation can classify the retained intent without repairing it (see BrainAgent's Notes contract). Inspection does not recover a missing receipt. The extension pauses writes on that runtime; resolve the uncertainty before starting a new authorized write session. Do not retry or create another note to compensate. Brain serializes cooperating writers; external editors that disregard its lock are not universally covered.

## StelaShell Project notes

With the StelaShell Brain Project bound as principal, use `ss_knowledge_list` and then `ss_knowledge_read` with the listed `note_id`. In Obsidian, open the Project's `notas/` folder. These are the durable references migrated from the former repository `docs/` collection:

- **Naming conventions**
- **Arquitectura y hoja de ruta de StelaShell**
- **Contrato de continuidad con Brain**
- **Contrato de colaboración entre sesiones PRIMARY**
- **Diseño de búsqueda web y lectura pública**

The design notes name their historical Git sources. Runtime setup, diagnostics and license notices remain beside their corresponding code. The selected Brain Memory holds current state. These lookup instructions do not migrate other folders or enable writes.

The opt-in integration tests take `SS_TEST_PI_CLI` and `SS_TEST_BRAIN_NOTES_EXE` (create/read/update) or `SS_TEST_BRAIN_NOTES_RENAME_EXE` (rename-capable Brain). They write only to isolated fixture vaults and use synthetic notes and a deterministic Pi RPC provider without inference network calls.
