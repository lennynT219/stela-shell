// Isolated Pi RPC fixture. The real SDK spawns Node, whose `exec` script is in the disposable Pi cwd.
// Production always checks login/config and never accepts a client, executable or signal from tool arguments.
import {Codex} from "@openai/codex-sdk";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {runImageRequest, startImageTurn} from "../../codex.ts";
import {registerImages} from "../../index.ts";

export default function streamFixture(pi: ExtensionAPI) {
  let waiting: () => void;
  pi.on("session_start", (_event, ctx) => { waiting = () => ctx.ui.notify("fixture: SDK stream waiting", "info") });
  registerImages(pi, {generate: request => runImageRequest(request, async (cwd, signal) => {
    const hold = request.prompt === "Fixture holding a turn open.";
    const client = new Codex({codexPathOverride: process.execPath, env: {
      FIXTURE_MODE: hold ? "hold" : "fail", FIXTURE_HOME: request.home,
      ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {})
    }});
    const {events} = await startImageTurn(client, cwd, {...request, signal});
    return {events: (async function*() {
      for await (const event of events) {
        yield event;
        // The consumer has requested another event, but the holding child will not send one.
        if (hold && event.type === "turn.started") waiting();
      }
    })()};
  })});
}
