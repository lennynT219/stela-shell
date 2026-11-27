import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FLOAT_BANDS, FLOAT_FRAMES } from "../mascot-icon.ts";

const bytes = (s: string) => Buffer.from(s, "base64");
const size = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

test("Stela ships the HD resting PNG at its native resolution and four one-row crops per pose", () => {
  const rest = readFileSync(new URL("../../../media/images/stela-idle-144.png", import.meta.url));
  assert.deepEqual(bytes(FLOAT_FRAMES[2]), rest);
  assert.equal(new Set(FLOAT_FRAMES).size, 6);
  assert.equal(FLOAT_BANDS.length, FLOAT_FRAMES.length);
  for (const [i, png] of FLOAT_FRAMES.entries()) {
    assert.deepEqual(size(bytes(png)), [144, 144]);
    assert.equal(FLOAT_BANDS[i].length, 4);
    for (const band of FLOAT_BANDS[i]) assert.deepEqual(size(bytes(band)), [144, 36]);
  }
});

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
test("Pi presents the large sprite only in a free corner, with the same draft and footer rows", {
  skip: !cli || process.platform !== "linux", timeout: 45_000,
}, async () => {
  const { stdout } = await promisify(execFile)("python3", ["-B", fileURLToPath(new URL("./fixtures/mascot-size.py", import.meta.url)), process.execPath, cli!], { timeout: 40_000 });
  assert.match(stdout, /Both layouts verified/);
});
