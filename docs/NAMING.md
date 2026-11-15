# Naming conventions

## Brand and language

- **Stela** is the company; **stela-shell** is the product/repository/package. The existing display spelling **StelaShell** also names the product, not the company.
- **`ss`** is the product's technical namespace, not a replacement for legal attribution, upstream names, repository URLs or the full product name.
- Code, public identifiers and agent-facing instructions stay in English. Product-owned visible titles are short Spanish labels, without repeating `Stela ·` or `SS ·` on every row.
- Capability labels: **Web**, **Sesiones**, **Tareas**, **Memoria** and **FARO**. A label does not imply that a planned capability is implemented.

## Code and public interfaces

| Element | Convention | Example |
| --- | --- | --- |
| Public tools | `ss_<area>_<action>`, lowercase snake_case | `ss_tasks_delegate` |
| Human commands | `/ss-<area>`, lowercase kebab-case | `/ss-sessions` |
| Public extension flags | `--ss-<area>-<setting>` | `--ss-tasks-concurrency` |
| Helper role | `ss-helper` | One bounded, read-only evidence worker |
| Visible titles | Short action/capability, normally one or two words | `Delegar`, `Enviar mensaje` |
| Folders and modules | Short English names; no redundant brand prefix | `extensions/web`, `search.ts` |
| Functions / variables | Descriptive camelCase within the module | `readPage`, `sendMessage` |
| Types / constants | PascalCase / UPPER_SNAKE_CASE | `PeerInfo`, `MAX_INBOX` |

Do not put provider names in product tool identifiers: `ss_web_search`, not `ss_exa_search`. Keep complete activation/message/task IDs in routing, schemas and diagnostics; a display label is never a routing alias.

`ss` is not installed as a shell command or global alias: Linux already uses `ss` for socket inspection. Examples that need a product shell alias use `stela-shell`; they do not alter the user's shell/profile automatically.

## Existing interface migration

| Previous identifier | Canonical identifier | Visible title |
| --- | --- | --- |
| `stela_delegate` | `ss_tasks_delegate` | Delegar |
| `stela_cancel` | `ss_tasks_cancel` | Cancelar tarea |
| `stela_sessions` | `ss_sessions_list` | Sesiones |
| `stela_message` | `ss_sessions_send` | Enviar mensaje |
| `/stela-tasks` | `/ss-tasks` | Tareas |
| `/stela-sessions` | `/ss-sessions` | Sesiones |
| `--stela-subagent-concurrency` | `--ss-tasks-concurrency` | — |
| `--stela-sessions-disabled` | `--ss-sessions-disabled` | — |
| `stela-helper` role | `ss-helper` | Ayudante |

The old public tool/command/flag names are not registered as duplicate aliases. Update scripts, explicit tool selections and name-based permission allow/deny rules before operator-controlled activation/reload. Renaming is not authorization to bypass a restriction: policy integrations must still cover the same operations under the canonical names.

The test CLI setting is `SS_TEST_PI_CLI`; tests also read `STELA_TEST_PI_CLI` for compatibility, with the canonical value taking precedence. Deterministic fixture provider/action names use `ss`/`SS`, not new credentials or services.

Web tools are `ss_web_search` (**Buscar web**) and `ss_web_read` (**Leer página**), implemented by the integrated fourth extension. Its three exact extraction dependencies belong to the root manifest/lock; there is no independent package. The earlier namespace migration itself installed no dependencies or empty web stub. Source registration does not activate or reload a profile.

## Presentation is not execution identity

Use Pi's `label` metadata AND explicit call/message renderers. Its default tool-card fallback can show the technical identifier even when a short label exists.

The compact call heading uses the Spanish label; expansion reveals the canonical technical identifier. Arguments remain visible as valid escaped JSON. Custom-message headings use **Ayudante** or **Mensaje** while retaining the evidence/provenance body. Rendering never rewrites executable arguments, model content, permission hooks or stored messages. Text components come from Pi's host-provided TUI; do not install a duplicate SDK/TUI dependency.

Renderer/component checks do not constitute a full interactive TUI, terminal, theme or real-model evaluation.

## Deliberately preserved compatibility names

This is not a global string replacement. Keep these contracts until a separately scoped migration demonstrates a need and preserves compatibility:

- Product/package/repository names and the configured `.stela-shell` profile path.
- Existing machine-local extension links, including `stela-method`, `stela-subagents` and `stela-sessions`. Link names are loading routes, not tool IDs; do not create a second route just to rename them.
- `STELA_SUBAGENT_CHILD` / `STELA_SUBAGENT_SCOPE` and `stela-helper-ready` / `stela-helper-blocked`: parent/child exclusion, scope and readiness contracts.
- `stela-subagent-result` / `stela-peer-message`: persisted custom-message/commitment identities. New renderers provide short headings without rewriting session history.
- `<profile>/stela-sessions`, POSIX `stela-...` socket directories and Windows `\\.\pipe\stela-...` namespaces; presence/wire schemas, framing, crypto and activation ownership remain unchanged.
- Cargo names, native manifests/locks, `stela-job.exe`, `stela-sessions.exe`, their artifact locations and private bridge arguments. Public naming does not require a native rebuild.
- Historical Git evidence, immutable private observation artifacts and upstream attribution/license text. The observation analyzer recognizes both old and canonical task-tool names without rewriting event identities or relaunching an experiment.

Changing any of these names may affect discovery, startup isolation, persisted evidence or native interoperability. Cosmetic consistency alone is not a reason to change them.

## Activation and verification

Source changes do not reload running Pi sessions. This migration neither edits active profiles/settings nor installs aliases, creates links, compiles native components or triggers reload. An operator should review name-based policies and script/tool selections before loading the new API.

Checks cover canonical registration/guidance, old-name absence from the active public surface, safe compact/expanded rendering, helper exclusion, isolated native Pi tool/permission/peer flows, linked extension loading and CLI flags. Linux execution does not establish a new Windows/macOS run or real-provider behavior. Current observed results and next work remain in [WORK_STATE](WORK_STATE.md).
