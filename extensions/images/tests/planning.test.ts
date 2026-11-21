import assert from "node:assert/strict";
import {test} from "node:test";
import {offeredSubmission, submittedPrompt, SUBMIT} from "../planning.ts";
import {imageRequest} from "../session.ts";

test("submissions carry their own text in either language, never an old draft, assent or a quoted command", () => {
  const prompt = "Acuarela vertical: una estación vacía.\nTexto exacto: «Sí». Sin personas.";
  assert.equal(submittedPrompt(SUBMIT + "\n" + prompt), prompt);
  assert.equal(submittedPrompt("Generate the image with this prompt: " + prompt), prompt);
  for (const s of ["Dibuja un faro", SUBMIT, SUBMIT + "   ", SUBMIT + " usa el anterior.",
                   SUBMIT + " sí", SUBMIT + " el borrador anterior", "Generate the image with this prompt: as above",
                   "Ejemplo: " + SUBMIT + " un faro", "```text\n" + SUBMIT + " un faro\n```"]) {
    assert.equal(submittedPrompt(s), undefined, s);
  }
  assert.equal(imageRequest("Crea una infografía del ciclo del agua"), true);
});

test("editor offer: only one bounded text block, no ambiguous alternatives or invisible terminal controls", () => {
  const draft = SUBMIT + "\r\nCartel cuadrado, ave azul, con el título «Marea».";
  const block = "```text\r\n" + draft + "\r\n```";
  assert.equal(offeredSubmission("Propuesta:\r\n" + block, 4096), draft);
  for (const s of [block + "\n" + block, block.slice(0,-3), block.replace("ave", "a\u202eve"),
                   block.replace("ave", "a\u001bve"), block.replace("text\r\n", "js\r\n"),
                   "```text\n" + SUBMIT + "\n" + "á".repeat(2049) + "\n```"]) {
    assert.equal(offeredSubmission(s, 4096), undefined);
  }
});
