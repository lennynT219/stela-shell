import assert from "node:assert/strict";
import {test} from "node:test";
import {visualBrief} from "../brief.ts";

test("the SS logo brief explains the subject and gives a drawable concept without inventing an official identity", () => {
  const request = "genera un logo que reprensete todo lo que es ss";
  const b = visualBrief(request, true);
  assert.equal(b.request, request);
  assert.equal(b.format, "Identity mark");
  assert.match(b.reference!, /terminal workspace/);
  assert.match(b.reference!, /memory.*session/);
  assert.match(b.concept!, /possible motif/);
  assert.match(b.composition, /icon size/);
  assert.equal(visualBrief(request, false).reference, undefined);
  assert.equal(visualBrief(request + ". Sin letras.", true).reference, b.reference);
  assert.equal(visualBrief("Crea un logotipo para Stela-Shell.", false).reference, b.reference);
});

test("unrelated subjects get visual direction for their own format, not SS branding or new lettering", () => {
  const request = 'Genera una portada para Marea, un club de lectura junto al mar. Texto exacto: “Marea”.\nSin azul.';
  const b = visualBrief(request, true);
  assert.equal(b.request, request);
  assert.equal(b.format, "Designed layout");
  assert.match(b.composition, /lettering/);
  assert.match(b.treatment, /override all defaults/);
  assert.equal(b.reference, undefined);
  assert.equal(b.concept, undefined);
  for (const other of ["Dibuja un retrato con el logo de un Chevrolet SS",
                       "Genera un logo para SS Great Britain",
                       "Genera un logo para SS, mi club de surf",
                       "Genera un logo para SS con una ola; SS es mi club de surf",
                       "Genera un logo para el proyecto SS Great Britain",
                       "Genera un logo para Marea, sin referencias a StelaShell",
                       "Genera un logo para Marea en vez de StelaShell",
                       "Dibuja una foto de un cartel con un logo"]) {
    assert.equal(visualBrief(other, true).reference, undefined);
  }
  assert.equal(visualBrief("Dibuja una foto de un cartel con un logo", true).format, "Still image in the requested medium");
});
