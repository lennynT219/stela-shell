// No browser, evaluation, URL loading or document-supplied resource fetching.
import { parentPort, workerData } from "node:worker_threads";
import { Parser } from "htmlparser2";

const clean = s => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "");
const clip = (s, n) => { const v = s.slice(0,n); return /[\ud800-\udbff]$/.test(v) ? v.slice(0,-1) : v; };
const normalize = s => clean(s).replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
try {
  const { body, contentType, section } = workerData;
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] ?? "utf-8";
  let input;
  try { input = new TextDecoder(charset, { fatal: true }).decode(body); }
  catch { throw new Error("UNSUPPORTED_CHARSET"); }
  let text = "", title = "", headings = [], preferred = false, html = false;
  if (/^(text\/html|application\/xhtml\+xml)(;|\s|$)/i.test(contentType)) {
    html = true;
    const all = [], main = [], stack = [];
    let nodes = 0, pre = 0, titleDepth = 0, heading, allLength = 0, mainLength = 0;
    const skipped = new Set(["script","style","noscript","template","svg","canvas","iframe","object","head","nav","footer"]);
    const blocks = new Set(["p","div","section","main","article","li","ul","ol","pre","br","tr","blockquote"]);
    const append = value => {
      all.push(value); allLength += value.length;
      if (stack.some(frame => frame.main)) { main.push(value); mainLength += value.length; }
    };
    const parser = new Parser({
      onopentag(name, attrs) {
        if (++nodes > 100000 || stack.length >= 256) throw new Error("DOCUMENT_COMPLEXITY");
        const parent = stack.at(-1);
        const frame = { name, skip: !!parent?.skip || skipped.has(name) || "hidden" in attrs ||
          attrs["aria-hidden"] === "true", main: name === "main" || name === "article" };
        stack.push(frame);
        if (name === "title" && stack.some(f => f.name === "head") && !stack.some(f => f.name === "svg")) titleDepth++;
        if (frame.skip) return;
        if (name === "pre") pre++;
        if (/^h[1-6]$/.test(name)) {
          heading = { text: "", complete: true, level: Number(name[1]), id: attrs.id && attrs.id.length <= 200 && clean(attrs.id) === attrs.id ? attrs.id : "",
            main: stack.some(f => f.main), start: allLength, mainStart: mainLength };
          append("\n\n" + "#".repeat(heading.level) + " ");
        } else if (blocks.has(name)) append("\n\n");
      },
      ontext(value) {
        if (titleDepth) title = clip(title + clean(value),200);
        if (!stack.at(-1)?.skip) {
          append(pre ? value : value.replace(/\s+/g, " "));
          if (heading) {
            heading.complete = heading.complete && heading.text.length + value.length <= 200;
            heading.text = clip(heading.text + value,200);
          }
        }
      },
      onclosetag(name) {
        const frame = stack.at(-1);
        if (!frame) return;
        if (!frame.skip) {
          if (/^h[1-6]$/.test(name)) {
            if (heading) {
              if (headings.length >= 1024) throw new Error("DOCUMENT_COMPLEXITY");
              headings.push({ ...heading, text: normalize(heading.text) });
            }
            heading = undefined; append("\n\n");
          } else if (blocks.has(name)) append("\n\n");
          if (name === "pre") pre--;
        }
        if (name === "title" && titleDepth > 0) titleDepth--;
        stack.pop();
      },
    }, { decodeEntities: true });
    parser.end(input);
    preferred = normalize(main.join("")).length > 0;
    text = (preferred ? main : all).join("");
    headings = headings.filter(h => !preferred || h.main).map(h => ({ ...h, start: preferred ? h.mainStart : h.start }));
  } else {
    text = input.replace(/\r\n?/g,"\n");
    let offset = 0, fence = null;
    for (const line of text.split("\n")) {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      } else if (!fence) {
        const match = /^(#{1,6})\s+(.+)$/.exec(line);
        if (match) {
          if (headings.length >= 1024) throw new Error("DOCUMENT_COMPLEXITY");
          headings.push({ level: match[1].length, text: match[2].trim(), id: "", start: offset });
        }
      }
      offset += line.length + 1;
    }
    title = headings[0]?.text.slice(0,200) ?? "";
  }
  let selected = null, matched = section ? false : null;
  if (section) {
    const query = section.trim().toLowerCase();
    const heading = headings.find(h => h.id && h.id === section.trim()) ?? headings.find(h => h.complete !== false && h.text.toLowerCase() === query);
    if (heading) {
      const index = headings.indexOf(heading);
      const next = headings.slice(index + 1).find(h => h.level <= heading.level);
      text = text.slice(heading.start, next?.start);
      selected = { heading: heading.text, id: heading.id || null }; matched = true;
    }
    if (!matched) text = "";
  }
  text = html ? normalize(text) : clean(text).trim();
  const truncated = text.length > 16384;
  parentPort.postMessage({ ok: true, text: clip(text,16384), title: normalize(title),
    selected, matched, truncated, preferred, empty: !text.trim() });
} catch (error) {
  const allowed = ["UNSUPPORTED_CHARSET","DOCUMENT_COMPLEXITY"];
  parentPort.postMessage({ ok: false, code: allowed.includes(error?.message) ? error.message : "EXTRACTION_FAILED" });
}
