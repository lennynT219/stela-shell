import {createHash, randomUUID} from "node:crypto";
import {closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync} from "node:fs";
import {basename, dirname, isAbsolute, join, relative, sep} from "node:path";
import {crc32, inflateSync} from "node:zlib";

export const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const IMAGE_FILE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}\.png$/;
export const MAX_BYTES = 12 * 1024 * 1024;
export class ImageError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "ImageError";
  }
}
export function fail(code: string): never {
  throw new ImageError(code);
}
export function within(parent: string, child: string) {
  const r = relative(parent, child);
  return !isAbsolute(r) && r !== ".." && !r.startsWith(".." + sep);
}
/** Refuse a redirected Codex output root before the SDK could write a preview there. */
export function ensurePreviewStore(project: string, home: string) {
  if (within(project, home)) return fail("unsafe_workspace");
  const root = join(home, "generated_images");
  const entry = lstatSync(root, {throwIfNoEntry: false});
  if (entry && (!entry.isDirectory() || realpathSync(root) !== root)) return fail("unsafe_directory");
}
export function pngName(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim()) return fail("invalid_name");
  const stem = value.replace(/\.png$/iu, "");
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(stem) || stem.endsWith(" ") ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(stem) || Buffer.byteLength(stem) > 120)
    return fail("invalid_name");
  return stem + ".png";
}
export function suggestedName(prompt: string): string {
  const words = prompt.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const skip = /^(?:genera(?:me)?|crea(?:me)?|dibuja(?:me)?|una?|imagen|de|generate|create|an?|image|of)$/;
  while (words.length && skip.test(words[0])) words.shift();
  try {
    return pngName(words.slice(0, 8).join("-").slice(0, 70));
  } catch {
    return "imagen.png";
  }
}

/** Narrow decoder for static, noninterlaced, 8-bit gray/RGB PNGs (+ optional alpha), not just a magic-byte check. */
export function inspectPng(b: Buffer) {
  if (b.length > MAX_BYTES || b.length < 57 ||
      !b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return fail("invalid_png");
  let width = 0, height = 0, channels = 0, sealed = false, ended = false;
  const idat: Buffer[] = [], display: Buffer[] = [b.subarray(0, 8)];
  for (let off = 8, count = 0; off < b.length; count++) {
    if (count > 4096 || off + 12 > b.length) return fail("invalid_png");
    const n = b.readUInt32BE(off), end = off + 8 + n;
    if (end + 4 > b.length || crc32(b.subarray(off + 4, end)) !== b.readUInt32BE(end))
      return fail("invalid_png");
    const start = off, type = b.toString("latin1", off + 4, off + 8), data = b.subarray(off + 8, end);
    off = end + 4;
    if (["IHDR", "IDAT", "IEND"].includes(type) || (type === "sRGB" && n === 1) ||
        (type === "gAMA" && n === 4) ||
        (type === "tRNS" && ((channels === 1 && n === 2) || (channels === 3 && n === 6))))
      display.push(b.subarray(start, off));
    if (count === 0 && type !== "IHDR") return fail("invalid_png");
    if (type === "IHDR") {
      if (count !== 0 || n !== 13) return fail("invalid_png");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = ({0: 1, 2: 3, 4: 2, 6: 4} as Record<number, number>)[data[9]] ?? 0;
      if (!width || !height || width > 8192 || height > 8192 || width * height > 12_000_000 ||
          data[8] !== 8 || !channels || data[10] || data[11] || data[12])
        return fail("invalid_png");
    } else if (type === "IDAT") {
      if (sealed) return fail("invalid_png");
      idat.push(data);
    } else if (type === "IEND") {
      if (n !== 0 || off !== b.length || !idat.length) return fail("invalid_png");
      ended = true;
    } else {
      // Ancillary metadata stays in the original file but is not inflated or forwarded to Pi. Reject unknown critical chunks and animated PNGs.
      if (!/^[a-zA-Z]{4}$/.test(type) ||
          (/^[A-Z]/.test(type) &&
           !(type === "PLTE" && [3, 4].includes(channels) && !idat.length && n > 0 && n <= 768 &&
             n % 3 === 0)) ||
          ["acTL", "fcTL", "fdAT"].includes(type))
        return fail("invalid_png");
      if (idat.length) sealed = true;
    }
  }
  if (!ended) return fail("invalid_png");
  const stride = width * channels + 1, expected = stride * height;
  try {
    const compressed = Buffer.concat(idat);
    const {buffer: raw, engine} =
        inflateSync(compressed, {maxOutputLength: expected, info: true}) as unknown as {
      buffer: Buffer;
      engine: {bytesWritten: number}
    };
    if (raw.length !== expected || engine.bytesWritten !== compressed.length) return fail("invalid_png");
    for (let i = 0; i < raw.length; i += stride)
      if (raw[i] > 4) return fail("invalid_png");
  } catch {
    return fail("invalid_png");
  }
  return {
    width,
    height,
    sha256: createHash("sha256").update(b).digest("hex"),
    preview: Buffer.concat(display)
  };
}

// Linux: anchor every relative operation to a directory FD, including exclusive publication.
// Elsewhere reject links/reparse-point redirects and recheck identities; this isn't a sandbox against a concurrent local filesystem adversary.
interface Dir {
  name: string;
  path: string;
  close(): void;
  check(): void
}
function directory(name: string, accessPath = name): Dir {
  const before = lstatSync(accessPath);
  if (!before.isDirectory() || realpathSync(name) !== name) return fail("unsafe_directory");
  if (process.platform === "linux") {
    const fd = openSync(accessPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    const s = fstatSync(fd);
    if (s.dev !== before.dev || s.ino !== before.ino) {
      closeSync(fd);
      return fail("unsafe_directory");
    }
    return {
      name,
      path: `/proc/self/fd/${fd}`,
      close: () => closeSync(fd),
      check: () => {
        const a = lstatSync(name);
        if (!a.isDirectory() || a.dev !== s.dev || a.ino !== s.ino || realpathSync(name) !== name)
          fail("unsafe_directory");
      }
    };
  }
  return {
    name,
    path: name,
    close: () => {},
    check: () => {
      const a = lstatSync(name);
      if (!a.isDirectory() || a.dev !== before.dev || a.ino !== before.ino || realpathSync(name) !== name)
        fail("unsafe_directory");
    }
  };
}
function subdir(parent: Dir, name: string, create = false) {
  parent.check();
  const access = join(parent.path, name);
  if (create) {
    try {
      mkdirSync(access, {mode: 0o700});
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  return directory(join(parent.name, name), access);
}

/** Resolve ONLY a file actually named by the SDK in the exact newly started thread. No directory listing, recency heuristics or arbitrary tool-supplied paths. */
export function reportedFile(home: string, thread: string, text: string) {
  if (!UUID.test(thread) || text.length > 16_384) return fail("no_png");
  const prefix = join(home, "generated_images", thread) + sep;
  const files = new Set<string>();
  let i = 0;
  while ((i = text.indexOf(prefix, i)) !== -1) {
    const start = i;
    i += prefix.length;
    if (start && !/[\s`"'(<\[]/.test(text[start - 1])) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9_-]{0,159}\.png)(?=$|[\s`"')>\]])/.exec(text.slice(i));
    if (m) files.add(m[1]);
  }
  if (files.size !== 1) return fail("no_png");
  return [...files][0];
}
function readPngAt(parent: Dir, file: string) {
  let fd: number|undefined;
  try {
    const p = join(parent.path, file), s = lstatSync(p);
    if (!s.isFile() || s.nlink !== 1 || s.size < 57 || s.size > MAX_BYTES) return fail("invalid_png");
    fd = openSync(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const o = fstatSync(fd);
    if (!o.isFile() || o.dev !== s.dev || o.ino !== s.ino || o.size !== s.size) return fail("source_changed");
    const bytes = Buffer.allocUnsafe(o.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!n) return fail("source_changed");
      offset += n;
    }
    const after = fstatSync(fd);
    if (after.size !== o.size || after.mtimeMs !== o.mtimeMs || after.ctimeMs !== o.ctimeMs)
      return fail("source_changed");
    parent.check();
    return {bytes, path: join(parent.name, file), ...inspectPng(bytes)};
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function readOriginal(home: string, thread: string, file: string) {
  if (!UUID.test(thread) || !IMAGE_FILE.test(file) || basename(file) !== file) return fail("no_png");
  const dirs: Dir[] = [];
  try {
    dirs.push(directory(home));
    dirs.push(subdir(dirs[0], "generated_images"));
    dirs.push(subdir(dirs[1], thread));
    const png = readPngAt(dirs[2], file);
    for (const d of dirs) d.check();
    return png;
  } catch (e) {
    if (e instanceof ImageError) throw e;
    return fail("source_unavailable");
  } finally {
    for (const d of dirs.reverse()) d.close();
  }
}

/** Only the local edit action calls this, with the single literal file selected in the live human submission. */
export function readPhotoFile(path: string) {
  let parent: Dir|undefined;
  try {
    parent = directory(dirname(path));
    const {width, height, preview} = readPngAt(parent, basename(path));
    return {width, height, preview};
  } catch (e) {
    if (e instanceof ImageError && e.message === "invalid_png") throw e;
    return fail("photo_unavailable");
  } finally {
    parent?.close();
  }
}

/** Bytes already matched the preview's digest. Stage inside the approved directory, then publish with link(2)'s atomic no-replace semantics. */
export function saveOriginal(root: string, name: string, bytes: Buffer, check: () => void) {
  const base = pngName(name).slice(0, -4);
  const dirs: Dir[] = [];
  let stage: string|undefined, fd: number|undefined;
  try {
    check();
    const project = directory(root);
    dirs.push(project);
    const media = subdir(project, "media", true);
    dirs.push(media);
    const images = subdir(media, "images", true);
    dirs.push(images);
    const tmp = join(images.path, `.ss-${randomUUID()}.tmp`);
    fd = openSync(tmp, "wx", 0o600);
    stage = tmp;
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    for (let i = 1; i <= 999; i++) {
      const file = base + (i === 1 ? "" : `-${i}`) + ".png";
      check();
      for (const d of dirs) d.check();
      try {
        linkSync(tmp, join(images.path, file));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw e;
      }
      try {
        for (const d of dirs) d.check();
      } catch {
        return fail("save_uncertain");
      }
      return join("media", "images", file);
    }
    return fail("name_taken");
  } catch (e) {
    if (e instanceof ImageError) throw e;
    return fail("save_failed");
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (stage) {
      try {
        unlinkSync(stage);
      } catch { /* Do not retry publication. */
      }
    }
    for (const d of dirs.reverse()) d.close();
  }
}
