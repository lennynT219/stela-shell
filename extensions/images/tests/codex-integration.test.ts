import assert from "node:assert/strict";
import {createServer, type Server, type ServerResponse} from "node:http";
import {mkdirSync, mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {Codex, type ThreadEvent} from "@openai/codex-sdk";
import {bundledCli, collect, runEditRequest, startEditTurn, startImageTurn} from "../codex.ts";
import {checkedLimits} from "../config.ts";
import {readOriginal} from "../files.ts";
import {png} from "./fixture.ts";

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), "ss-img-native-"));
  const home = join(tmp, "codex"), cwd = join(tmp, "canvas");
  mkdirSync(home);
  mkdirSync(cwd);
  return {
    tmp,
    home,
    cwd,
    env: {
      HOME: tmp,
      USERPROFILE: tmp,
      CODEX_HOME: home,
      PATH: process.platform === "win32" ? process.env.PATH! : "/usr/bin:/bin",
      ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {})
    }
  };
}
test("pinned Codex: image requests disable both memory flags without changing config.toml", async () => {
  const {tmp, home, cwd, env} = setup(), bin = bundledCli(), path = join(home, "config.toml");
  try {
    for (const alias of ["memory_tool = true\n", ""]) {
      const profile = "[features]\nmemories = true\n" + alias;
      writeFileSync(path, profile);
      // checkedLimits reads the effective config from the bundled runtime and requires false, not just an argv flag.
      const overrides = await checkedLimits(bin, cwd, env, AbortSignal.timeout(10_000));
      assert.ok(overrides.includes("features.memories=false"));
      assert.ok(overrides.includes("features.memory_tool=false"));
      assert.equal(readFileSync(path, "utf8"), profile);
    }
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
});

test(
    "pinned Codex config: user MCP is disabled only for the image invocation; a legacy sandbox override or redirected service fails closed",
    async () => {
      const {tmp, home, cwd, env} = setup(), bin = bundledCli(), signal = AbortSignal.timeout(16_000);
      const path = join(home, "config.toml");
      try {
        const toml = "[mcp_servers.\"demo.server\"]\ncommand=\"not-executed\"\n";
        writeFileSync(path, toml);
        const c = await checkedLimits(bin, cwd, env, signal);
        assert.ok(c.some(v => v.includes("\"demo.server\"={enabled=false}")));
        assert.equal(readFileSync(path, "utf8"), toml);
        for (const config of ["sandbox_mode=\"read-only\"", "chatgpt_base_url=\"http://127.0.0.1:1\""]) {
          writeFileSync(path, config + "\n");
          await assert.rejects(checkedLimits(bin, cwd, env, signal), /configuration/);
        }
      } finally {
        rmSync(tmp, {recursive: true, force: true});
      }
    });

// Both cases use the same local Responses transport. Only the fixture chooses what is returned.
function fixtureClient(env: Record<string, string>, overrides: string[], port: number) {
  return new Codex({
    env,
    config: {
      model_provider: "fixture", model: "gpt-6.2-sol", analytics: {enabled: false}, check_for_update_on_startup: false,
      model_providers: {fixture: {
        name: "fixture", wire_api: "responses", base_url: `http://127.0.0.1:${port}/v1`,
        supports_websockets: false, request_max_retries: 0, stream_max_retries: 0
      }}
    },
    configOverrides: overrides.filter(s => !s.startsWith("model_provider=") && !s.startsWith("forced_login_method="))
  });
}
async function loopbackPort(server: Server) {
  await new Promise<void>((ok, no) => { server.once("error", no); server.listen(0, "127.0.0.1", ok) });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return addr.port;
}
function respond(res: ServerResponse, model: string, n: number, output: {text: string}|{input: string}) {
  res.writeHead(200, {"content-type": "text/event-stream"});
  const emit = (v: object) => res.write(`data: ${JSON.stringify(v)}\n\n`);
  const base = {id: "response-fixture-" + n, object: "response", model, created_at: 0, status: "in_progress", output: []};
  emit({type: "response.created", response: base});
  const item = "text" in output ?
      {type: "message", id: "msg_fixture", role: "assistant", status: "completed",
       content: [{type: "output_text", text: output.text, annotations: []}]} :
      {type: "custom_tool_call", id: "ctc_fixture", namespace: "functions", name: "exec", call_id: "call_fixture",
       status: "completed", input: output.input};
  emit({type: "response.output_item.added", output_index: 0,
        item: {...item, status: "in_progress", ...("text" in output ? {content: []} : {input: ""})}});
  if ("text" in output)
    emit({type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: output.text});
  emit({type: "response.output_item.done", output_index: 0, item});
  emit({type: "response.completed", response: {
    ...base, status: "completed", output: [item], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}
  }});
  res.end();
}

test("pinned SDK and bundled Codex: a single private edit copy becomes an image input to loopback, not a path in the text", {timeout: 25_000}, async () => {
  const {tmp, home, cwd: project, env} = setup(), signal = AbortSignal.timeout(18_000);
  const reference = png(89), instructions = "Preserva el sujeto de prueba. Cambia el fondo a azul.", file = "edited.png";
  let posts = 0, workspace = "", inputImages: string[] = [], inputText: string[] = [], failure: unknown, checks = 0;
  const started = Promise.withResolvers<string>();
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/v1/responses" || ++posts !== 1) throw Error("unexpected request");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const content = body.input.filter((m: any) => m.role === "user").flatMap((m: any) => m.content);
      inputImages = content.filter((c: any) => c.type === "input_image").map((c: any) => c.image_url);
      inputText = content.filter((c: any) => c.type === "input_text").map((c: any) => c.text);
      const thread = await started.promise;
      if (!thread || res.destroyed) return;
      const dir = join(home, "generated_images", thread);
      mkdirSync(dir, {recursive: true});
      writeFileSync(join(dir, file), png(101), {flag: "wx"}); // fixture output, not a model edit
      respond(res, body.model, posts, {text: "`" + join(dir, file) + "`"});
    } catch (e) { failure = e; res.writeHead(400).end() }
  });
  try {
    const port = await loopbackPort(server);
    const result = await runEditRequest({home, project, prompt: instructions, photo: reference, signal, checkCurrent: () => { checks++ }}, async (cwd, active) => {
      workspace = cwd;
      assert.deepEqual(readdirSync(cwd), ["source.png"]);
      const staged = join(cwd, "source.png");
      assert.deepEqual(readFileSync(staged), reference);
      if (process.platform !== "win32") {
        assert.equal(statSync(cwd).mode & 0o077, 0);
        assert.equal(statSync(staged).mode & 0o077, 0);
      }
      const cfg = await checkedLimits(bundledCli(), cwd, env, active);
      const {events} = await startEditTurn(fixtureClient(env, cfg, port), cwd, {prompt: instructions, signal: active});
      return {events: (async function*() {
        for await (const e of events) {
          if (e.type === "thread.started") started.resolve(e.thread_id);
          yield e;
        }
      })()};
    });
    if (failure) throw failure;
    assert.equal(posts, 1);
    assert.equal(inputImages.length, 1);
    assert.equal(inputImages[0], "data:image/png;base64," + reference.toString("base64"));
    const brief = inputText.find(s => s.includes("Edit the single attached photo"));
    assert.ok(brief && !brief.includes("source.png") && !brief.includes(project));
    assert.deepEqual(JSON.parse(brief.split("\n").at(-1)!), {instructions});
    assert.ok(checks > 0 && workspace && !existsSync(workspace));
    assert.deepEqual(readOriginal(home, result.thread, result.file).bytes, png(101));
  } finally {
    started.resolve("");
    server.closeAllConnections();
    await new Promise<void>(ok => server.close(() => ok()));
    rmSync(tmp, {recursive: true, force: true});
  }
});

test("pinned Codex: collect the entire text-only stream with the memory_tool startup notice", {timeout: 20_000}, async t => {
  const {tmp, home, cwd, env} = setup(), signal = AbortSignal.timeout(15_000);
  const started = Promise.withResolvers<string>(), file = "text-only.png";
  let posts = 0;
  const server = createServer(async (req, res) => {
    req.resume();
    if (req.method !== "POST" || req.url !== "/v1/responses" || ++posts !== 1) {
      res.writeHead(400).end();
      return;
    }
    const thread = await started.promise;
    if (thread && !res.destroyed)
      respond(res, "gpt-6.2-sol", posts, {text: "`" + join(home, "generated_images", thread, file) + "`"});
  });
  try {
    const profile = "[features]\nmemories=true\nmemory_tool=true\n", configPath = join(home, "config.toml");
    writeFileSync(configPath, profile);
    const cfg = await checkedLimits(bundledCli(), cwd, env, signal);
    const client = fixtureClient(env, cfg, await loopbackPort(server));
    const turn = client.startThread({workingDirectory: cwd, skipGitRepoCheck: true, approvalPolicy: "never", webSearchMode: "disabled"});
    const {events} = await turn.runStreamed("Text-only protocol test. Return the fixture text; do not call tools.", {signal});
    const seen: ThreadEvent[] = [];
    const result = await collect((async function*() {
      for await (const event of events) {
        seen.push(event);
        if (event.type === "thread.started") started.resolve(event.thread_id);
        yield event; // observe, never strip, replace or synthesize an SDK event
      }
    })(), home, signal);

    const [thread, notice, turnStart, ...rest] = seen;
    assert.ok(thread?.type === "thread.started" && turnStart?.type === "turn.started");
    assert.ok(notice?.type === "item.completed" && notice.item.type === "error");
    const warning = notice.item;
    assert.match(warning.message, /memory_tool.*deprecated/u);
    assert.equal(rest.at(-1)?.type, "turn.completed");
    assert.deepEqual(result, {thread: thread.thread_id, file});
    assert.equal(posts, 1);
    assert.equal(readFileSync(configPath, "utf8"), profile);
    assert.throws(() => readOriginal(home, result.thread, result.file), /source_unavailable/);

    await t.test("only the exact startup item is optional; it cannot complete the turn or authorize an operation", async () => {
      const atStartup = (...prefix: ThreadEvent[]) => [thread, ...prefix, turnStart, ...rest];
      const replay = (seq: ThreadEvent[]) => collect((async function*() { yield* seq })(), home, signal);
      const unexpected: [string, ThreadEvent[]][] = [
        ["before thread", [notice, thread, turnStart, ...rest]],
        ["repeated", atStartup(notice, notice)],
        ["inside turn", [thread, turnStart, notice, ...rest]],
        ["after completion", [...seen, notice]],
        ["different startup warning", atStartup({...notice, item: {...warning, message: "fixture warning"}})],
        ["same prefix, different text", atStartup({...notice, item: {...warning, message: warning.message + "!"}})],
        ["wrong event type", atStartup({type: "item.updated", item: warning})],
        ["missing item identity", atStartup({...notice, item: {...warning, id: ""}})],
        ["operation after notice", [thread, notice, turnStart, {type: "item.started", item: {
          id: "fixture", type: "command_execution", command: "(fixture, never executed)",
          status: "in_progress", aggregated_output: ""
        }}, ...rest]],
      ];
      for (const [label, seq] of unexpected)
        await assert.rejects(replay(seq), {name: "ImageError", message: "unexpected_result"}, label);
      await assert.rejects(replay([thread, notice]), /incomplete/);
      await assert.rejects(replay([thread, notice, turnStart, {type: "turn.failed", error: {message: "quota"}}]), /quota/);
      await assert.rejects(replay([thread, {type: "error", message: warning.message}]), /generation_failed/);
      await assert.rejects(replay([thread, notice, turnStart, {type: "item.completed", item: {
        id: "fixture", type: "agent_message", text: "`" + join(tmp, file) + "`"
      }}, rest.at(-1)!]), /no_png/);
    });
  } finally {
    started.resolve(""); // also release a waiting reply if startup failed
    server.closeAllConnections();
    await new Promise<void>(ok => server.close(() => ok()));
    rmSync(tmp, {recursive: true, force: true});
  }
});

test(
    "real SDK with an enabled memory alias: send a self-contained logo brief to loopback, deny a dummy write, return the fixture PNG path",
    {timeout: 35_000}, async () => {
      const {tmp, home, cwd, env} = setup(), signal = AbortSignal.timeout(24_000);
      const probeName = "sdk-write-probe.txt", image = png(83, true), file = "exec-fixture.png";
      const request = "Genera un logo que reprensete todo lo que es ss, sin letras y en blanco y negro.";
      const project = fileURLToPath(new URL("../../../", import.meta.url));
      let threadId = "", requests = 0, toolNames: string[] = [], patchResult = "", failure: unknown;
      let userText: string[] = [];
      const server = createServer(async (req, res) => {
        try {
          if (req.method !== "POST" || req.url !== "/v1/responses" || ++requests > 2)
            throw new Error("Unexpected fixture request");
          const parts: Buffer[] = [];
          for await (const part of req) parts.push(part);
          const body = JSON.parse(Buffer.concat(parts).toString());
          if (requests === 1) {
            assert.ok(!body.input.some((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "input_image")), "text generation receives no source photo");
            userText = body.input.filter((m: any) => m.role === "user").flatMap((m: any) =>
              typeof m.content === "string" ? [m.content] :
                  m.content.filter((p: any) => p.type === "input_text").map((p: any) => p.text));
          }
          if (requests === 1) {
            // Only a benign marker in the temporary workspace. This checks execution, not just tool labels or flags.
            const patch = "*** Begin Patch\n*** Add File: " + probeName + "\n+fixture\n*** End Patch";
            const input =
                `text(ALL_TOOLS.map(t=>t.name));text(await tools.apply_patch(${JSON.stringify(patch)}));`;
            respond(res, body.model, requests, {input});
          } else {
            const result = body.input.find(
                (v: any) => v.type === "custom_tool_call_output" && v.call_id === "call_fixture");
            patchResult = JSON.stringify(result?.output ?? "");
            toolNames =
                (patchResult.match(
                     /(?:exec_command|view_image|spawn_agent|apply_patch|mcp__demo|web_search)/g) ??
                 []);
            assert.ok(threadId);
            const dir = join(home, "generated_images", threadId);
            mkdirSync(dir, {recursive: true});
            writeFileSync(join(dir, file), image, {flag: "wx"});
            respond(res, body.model, requests, {text: "`" + join(dir, file) + "`"});
          }
        } catch (e) {
          failure = e;
          res.end();
        }
      });
      try {
        const port = await loopbackPort(server);
        const configPath = join(home, "config.toml"), profile = "[features]\nmemories=true\nmemory_tool=true\n";
        writeFileSync(configPath, profile, {flag: "wx"});
        const cfg = await checkedLimits(bundledCli(), cwd, env, signal);
        // Test transport only: no plan, secrets, remote service, CLI override, project/history, or production option for selecting another provider.
        const client = fixtureClient(env, cfg, port);
        const {events} = await startImageTurn(client, cwd, {prompt: request, project, signal});
        const records = [];
        for await (const ev of events) {
          if (ev.type === "thread.started") threadId = ev.thread_id;
          records.push(ev);
        }
        if (failure) throw failure;
        assert.equal(requests, 2);
        assert.equal(readFileSync(configPath, "utf8"), profile);
        const briefText = userText.find(s => s.includes("Art-direct the image:"));
        assert.ok(briefText, "Expected a structured visual brief in the SDK request");
        const brief = JSON.parse(briefText.split("\n").at(-1)!);
        assert.equal(brief.request, request);
        assert.equal(brief.format, "Identity mark");
        assert.match(brief.reference, /StelaShell.*terminal.*Pi/s);
        assert.match(brief.concept, /paths joining/);
        assert.ok(!briefText.includes(project));
        assert.ok(!existsSync(join(cwd, probeName)));
        assert.match(
            patchResult,
            /reject|denied|not (?:allowed|writable|permitted)|read.only|prohibit|sandbox|outside|not found|unavailable|not a function/i,
            "The runtime must refuse or not offer the fixture write");
        for (const tool of ["exec_command", "view_image", "spawn_agent", "mcp__demo", "web_search"])
          assert.ok(!toolNames.includes(tool), `Unexpected tool ${tool}`);
        // The runtime may emit a failed file_change for this intentional negative probe. Production rejects that whole turn.
        if (records.some(e => "item" in e && e.item.type === "file_change"))
          await assert.rejects(
              collect(
                  (async function*() {
                    yield* records;
                  })(),
                  home, signal),
              /unexpected_result/);
        const last = records.findLast(e => e.type === "item.completed" && e.item.type === "agent_message");
        assert.ok(last && "item" in last && last.item.type === "agent_message");
        assert.ok(last.item.text.includes(join(home, "generated_images", threadId, file)));
        assert.equal(records.at(-1)?.type, "turn.completed");
        assert.deepEqual(readOriginal(home, threadId, file).bytes, image);
      } finally {
        server.closeAllConnections();
        await new Promise<void>(ok => server.close(() => ok()));
        rmSync(tmp, {recursive: true, force: true});
      }
    });
