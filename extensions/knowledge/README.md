# Brain project knowledge

This extension consults canonical project notes on demand. It does not replace `ss_memory_read` / `ss_memory_save`, inject all notes into context, persist notes as a second authority, or traverse links. Pi may retain a tool result or write input in its ordinary session transcript; that transcript is not authoritative. Do not use these tools for secrets or for personal notes.

## Operator setup

Use a compatible Brain build that supports the `brain notes` JSON endpoint. StelaShell starts that executable directly, using `BRAIN_BIN` or `brain` on PATH and Brain's existing configured vault. It does not create projects, directories or binding files. In the exact working directory, the operator provisions an ignored `.brain-notes.toml`:

```toml
binding_version = 1
project_id = "<actual Brain Project UUID>"
project_path = "01-proyectos/<folder>/<Project>.md"
allow_write = false
```

Use the actual Project identity, not a Memory ID. The Project has its own `notas/` directory, with the project notes directly inside it. Brain checks scope; note either belongs to that directory or is not addressable by the endpoint. No parent binding lookup, unscoped Note search, arbitrary path, or model-provided project or vault selection. A binding change invalidates the existing tool scope; start a fresh session after an operator change. Activate the extension through one route only.

- **Read:** `ss_knowledge_list` lists note titles and IDs; `ss_knowledge_read` opens one note by ID. Read after genuine local input or live authenticated PRIMARY activity; helpers are excluded.
- **Write:** both `allow_write = true` and explicit activation of the relevant Pi tool are required. The write tools are inactive by default and do not take peer activity as a write grant. `ss_knowledge_create` requires a current list so the existing notes can be checked for a canonical home; `ss_knowledge_update` requires a fresh read in the session. The exact baseline stays in host memory; only the body is replaced. The update can fail with `conflict` if the backing note changed.
- After `save_unconfirmed`, stop writes. Inspect Brain with a new explicit read or list; that may establish current state, not recover a missing receipt. The extension pauses writes on that runtime; resolve the uncertainty before starting a new authorized write session. Do not retry or create another note to compensate. Brain serializes cooperating writers; external editors that disregard its lock are not universally covered.

For the naming pilot, copy the complete current naming document into one scoped note, then read it from a fresh read-only session and compare the complete body (including compatibility exceptions). Check repository references before retiring the old document; a pilot in a temporary vault is not publication in the canonical vault.

The opt-in integration test takes `SS_TEST_PI_CLI` and `SS_TEST_BRAIN_NOTES_EXE`, writes only to an isolated fixture vault, and uses a deterministic Pi RPC provider without inference network calls.
