// Test-only composition root. Production has no env flag or model argument for replacing the generator.
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerImages} from "../../index.ts";
import {renderFixture} from "../fixture.ts";
export default function fixture(pi: ExtensionAPI) {
  registerImages(pi, {generate: renderFixture, edit: request => renderFixture({
    ...request, prompt: request.prompt + request.photo.toString("base64")
  })});
}
