import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { bundledCodexBin, childEnv, codexHome } from "../codex-runtime.ts";

export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export type Command = { bin: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string };
export const readOnlyArgs = ["-c", 'chatgpt_base_url="https://chatgpt.com/backend-api/"',
  "-c", "features.plugins=false", "-c", "features.apps=false", "-c", "analytics.enabled=false", "app-server", "--stdio"];
export async function localCommand(): Promise<Command | undefined> {
  const home = codexHome();
  const dir = await stat(home).catch(e => { if (e.code === "ENOENT") return null; throw e; });
  if (!dir) return undefined;
  if (!dir.isDirectory()) throw Error("Codex home unavailable");
  return { bin: bundledCodexBin(), cwd: tmpdir(), env: childEnv(home), args: readOnlyArgs };
}

type Request = { method: "account/rateLimits/read" | "model/list"; params: Record<string, unknown> };
type Receipt = { result?: unknown; error?: unknown };
export type Conversation<T> = Generator<Request, T, Receipt>;
/** One bounded read-only conversation with a pinned app-server. No login, turn, polling or retry. */
export function exchange<T>(cmd: Command, signal: AbortSignal, client: string,
  conversation: Conversation<T>, unavailable: T): Promise<T> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve(unavailable);
    const p = spawn(cmd.bin, cmd.args, { cwd: cmd.cwd, env: cmd.env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true, shell: false });
    let done = false, id = 1, buf = "", bytes = 0;
    const stop = () => finish(unavailable);
    const finish = (value: T) => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener("abort", stop);
      p.stdin.end(); if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
      resolve(value);
    };
    const timer = setTimeout(stop, 8_000); timer.unref();
    signal.addEventListener("abort", stop, { once: true });
    p.once("error", stop); p.once("close", stop); p.stdin.on("error", stop); p.stdout.on("error", stop);
    const send = (v: object) => p.stdin.write(JSON.stringify(v) + "\n");
    p.stdout.setEncoding("utf8"); p.stdout.on("data", (chunk: string) => {
      if (done) return;
      if ((bytes += Buffer.byteLength(chunk)) > 512 * 1024) return stop();
      buf += chunk;
      let end: number;
      while (!done && (end = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, end); buf = buf.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (!record(msg)) return stop();
          if (msg.method && msg.id == null) continue;
          if (msg.method || msg.id !== id || Object.hasOwn(msg, "error") === Object.hasOwn(msg, "result")) return stop();
          if (id === 1) {
            if (!record(msg.result)) return stop();
            send({ method: "initialized" });
          }
          const step = id === 1 ? conversation.next() : conversation.next(msg);
          if (step.done) return finish(step.value);
          send({ id: ++id, ...step.value });
        } catch { return stop(); }
      }
    });
    send({ id, method: "initialize", params: { clientInfo: { name: client, version: "1" } } });
  });
}
