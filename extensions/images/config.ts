import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {fail, ImageError} from "./files.ts";

// Use the official local config reader. It reads managed and per-user layers without using a model. Never log its payload, which can contain provider or MCP configuration.
async function effectiveConfig(
    bin: string, cwd: string, env: Record<string, string>, overrides: string[],
    signal: AbortSignal): Promise<Record<string, any>> {
  const deadline = AbortSignal.timeout(10_000), stop = AbortSignal.any([deadline, signal]);
  stop.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
        bin, [...overrides.flatMap(v => ["-c", v]), "app-server", "--stdio"],
        {cwd, env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "ignore"]});
    let buf = "", size = 0, initialized = false, finished = false, config: Record<string, any>|undefined;
    const abort = () => {
      child.kill("SIGKILL");
    }, bad = () => {
      finished = true;
      config = undefined;
      abort();
    };
    stop.addEventListener("abort", abort, {once: true});
    child.once("error", bad);
    child.stdin.on("error", () => {
      if (!finished) bad();
    });
    child.once("close", () => {
      stop.removeEventListener("abort", abort);
      if (!stop.aborted && config)
        resolve(config);
      else
        reject(new ImageError(signal.aborted ? "cancelled" : "configuration"));
    });
    const send = (x: object) => child.stdin.write(JSON.stringify(x) + "\n");
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (s: string) => {
      if (finished) return;
      if ((size += Buffer.byteLength(s)) > 2 * 1024 * 1024) {
        bad();
        return;
      }
      buf += s;
      let i;
      while (!finished && (i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.error) {
            bad();
            return;
          }
          if (e.id === 1 && !initialized && e.result) {
            initialized = true;
            send({method: "initialized"});
            send({id: 2, method: "config/read", params: {cwd, includeLayers: false}});
          } else if (e.id === 2 && initialized) {
            const c = e.result?.config;
            if (!c || typeof c !== "object" || Array.isArray(c)) {
              bad();
              return;
            }
            config = c;
            finished = true;
            child.stdin.end();
            abort();
          }
        } catch {
          bad();
          return;
        }
      }
    });
    if (stop.aborted) {
      abort();
      return;
    }
    send({id: 1, method: "initialize", params: {clientInfo: {name: "stela-shell-images", version: "1"}}});
  });
}
export const policyName = "ss_image_preview";
export const limits = [
  "model_provider=\"openai\"",
  "forced_login_method=\"chatgpt\"",
  "project_doc_max_bytes=0",
  "allow_login_shell=false",
  `default_permissions="${policyName}"`,
  `permissions.${policyName}.filesystem={":workspace_roots"="read"}`,
  "approval_policy=\"never\"",
  "web_search=\"disabled\"",
  "shell_environment_policy.inherit=\"none\"",
  "features.shell_tool=false",
  "features.unified_exec=false",
  "features.view_image=false",
  "features.apps=false",
  "features.plugins=false",
  "agents.enabled=false",
  "features.multi_agent_v2=false",
  "agents.max_depth=0",
  "features.computer_use=false",
  "features.browser_use=false",
  "features.browser_use_external=false",
  "features.code_mode=false",
  "features.memories=false",
  // Codex 0.171.0 can re-enable memories from this older spelling in the user's profile.
  "features.memory_tool=false",
  "features.goals=false",
  "features.sleep_tool=false",
  "features.skill_search=false",
  "features.skill_mcp_dependency_install=false",
  "features.shell_snapshot=false",
  "features.unbounded_connection_retries=false",
];
function official(url: unknown, host: string) {
  if (url == null) return true;
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && u.host === host && !u.username && !u.password;
  } catch {
    return false;
  }
}
function empty(x: unknown): boolean {
  return x == null ||
      (Array.isArray(x) ? x.length === 0 : typeof x === "object" && Object.values(x).every(empty));
}
function validate(c: Record<string, any>) {
  const profile = c.permissions?.[policyName], fs = profile?.filesystem;
  // Passing --sandbox or inheriting sandbox_mode would override the named, restricted-read profile.
  if (c.sandbox_mode != null || c.default_permissions !== policyName || !profile || profile.extends != null ||
          !empty(profile.workspace_roots) || !empty(profile.network) || !fs ||
          fs[":workspace_roots"] !== "read" ||
          Object.entries(fs).some(([k, v]) => k !== ":workspace_roots" && v != null))
    return fail("configuration");
  if (c.model_provider !== "openai" || c.forced_login_method !== "chatgpt" ||
      !official(c.chatgpt_base_url, "chatgpt.com") || !official(c.openai_base_url, "api.openai.com") ||
      !empty(c.model_providers?.openai))
    return fail("configuration");
  if (c.project_doc_max_bytes !== 0 || c.approval_policy !== "never" || c.web_search !== "disabled" ||
      c.agents?.enabled !== false || c.agents?.max_depth !== 0)
    return fail("configuration");
  if (c.notify?.length || !empty(c.hooks) || c.model_instructions_file || c.developer_instructions ||
      c.instructions || c.model_catalog_json)
    return fail("configuration");
  for (const rule of limits.filter(v => v.startsWith("features.") && v.endsWith("=false"))) {
    if (c.features?.[rule.slice(9, -6)] !== false) return fail("configuration");
  }
}
export async function checkedLimits(
    bin: string, cwd: string, env: Record<string, string>, signal: AbortSignal) {
  if (existsSync(join(env.CODEX_HOME, "hooks.json"))) return fail("configuration");
  const initial = await effectiveConfig(bin, cwd, env, limits, signal);
  validate(initial);
  const servers = initial.mcp_servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers) || Object.keys(servers).length > 64)
    return fail("configuration");
  const overrides = [...limits], disabled: string[] = [];
  for (const [k, val] of Object.entries(servers)) {
    if (!/^[\w.-]{1,100}$/.test(k)) return fail("configuration");
    if ((val as any)?.enabled !== false) disabled.push(`${JSON.stringify(k)}={enabled=false}`);
  }
  if (disabled.length) overrides.push(`mcp_servers={${disabled.join(",")}}`);
  if (overrides.length !== limits.length) {
    const final = await effectiveConfig(bin, cwd, env, overrides, signal);
    validate(final);
    if (Object.values(final.mcp_servers ?? {}).some((v: any) => v?.enabled !== false))
      return fail("configuration");
  }
  return overrides;
}
