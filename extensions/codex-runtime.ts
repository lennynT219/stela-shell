import {createRequire} from "node:module";
import {homedir} from "node:os";
import {dirname, isAbsolute, join, resolve} from "node:path";

export function codexHome(env: NodeJS.ProcessEnv = process.env) {
  const value = env.CODEX_HOME || join(homedir(), ".codex");
  if (!isAbsolute(value)) throw new Error("Invalid Codex home");
  return resolve(value);
}
// The SDK resolves its own native package as well. Never discover a CLI on PATH, print credentials, or start login on load.
export function bundledCodexBin() {
  try {
    const sdk = createRequire(import.meta.resolve("@openai/codex-sdk"));
    const pkg = sdk.resolve("@openai/codex/package.json"), req = createRequire(pkg);
    const platforms: Record<string, string> = {
      linux: "unknown-linux-musl",
      darwin: "apple-darwin",
      win32: "pc-windows-msvc"
    };
    const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : null;
    if (!platforms[process.platform] || !arch) throw new Error("Bundled Codex runtime unavailable");
    const root = dirname(req.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`));
    return join(
        root, "vendor", `${arch}-${platforms[process.platform]}`, "bin",
        process.platform === "win32" ? "codex.exe" : "codex");
  } catch {
    throw new Error("Bundled Codex runtime unavailable");
  }
}
export function childEnv(home: string, source: NodeJS.ProcessEnv = process.env) {
  const env: Record<string, string> = {CODEX_HOME: home};
  for (const k
           of ["HOME", "USER", "USERPROFILE", "LOGNAME", "SystemRoot", "SYSTEMROOT", "WINDIR", "APPDATA",
               "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "PATH", "LANG", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
               "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "SSL_CERT_FILE",
               "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "ALL_PROXY", "https_proxy",
               "http_proxy", "no_proxy", "all_proxy"])
    if (source[k]) env[k] = source[k]!;
  return env;
}
