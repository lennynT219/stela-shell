// Test-only composition root. Production has no env flag or model argument for replacing the generator.
import {createHash} from "node:crypto";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerImages} from "../../index.ts";
import {renderFixture} from "../fixture.ts";
export default function fixture(pi: ExtensionAPI) {
  registerImages(pi, {generate: renderFixture, generateWithReferences: request => {
    const hash = createHash("sha256").update(request.prompt);
    for (const ref of request.references) hash.update(ref);
    return renderFixture({...request, prompt: "x".repeat(hash.digest()[0])});
  }, edit: request => renderFixture({
    ...request, prompt: request.prompt + request.photo.toString("base64")
  })});
}
