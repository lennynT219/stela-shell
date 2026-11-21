import {crc32, deflateSync} from "node:zlib";
import {randomUUID} from "node:crypto";
import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import type {Generate} from "../codex.ts";
export function chunk(type: string, data: Buffer) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), out.length - 4);
  return out;
}
export function png(value = 70, metadata = false) {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(2);
  h.writeUInt32BE(1, 4);
  h[8] = 8;
  h[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", h),
    ...(metadata ? [chunk("tEXt", Buffer.from("comment\0for the original only"))] : []),
    chunk("IDAT", deflateSync(Buffer.from([0, value, 50, 120, 255, 255, 255]))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
export const renderFixture: Generate = async ({home, prompt, signal}) => {
  signal.throwIfAborted();
  const thread = randomUUID(), file = `exec-${randomUUID()}.png`,
        dir = join(home, "generated_images", thread);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, file), png(Buffer.byteLength(prompt) % 230, true), {flag: "wx"});
  return {thread, file};
};
