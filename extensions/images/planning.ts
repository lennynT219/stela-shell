// The chat model helps write the brief. No extra model, image runtime or project data is needed here.
export const SUBMIT = "Genera la imagen con este prompt:";
const submitLine = /^(?:Genera la imagen con este prompt|Generate the image with this prompt):\s*/iu;
export function submissionBody(raw: string): string|undefined {
  const input = raw.trim(), prefix = submitLine.exec(input);
  return prefix ? input.slice(prefix[0].length) : undefined;
}

export const planningRules = [
  "Help design images in the user's language. Ideas, brainstorming, requests for prompt text, and answers to design questions are conversation, not generation. No image tools while discussing the idea.",
  "Use what the user already told you. Ask one or two concrete questions only if important visual choices remain unresolved. Never ask again about supplied details. If the request is clear or the user delegated the choices, don't ask needless questions.",
  "When the user directly requests text-to-image generation (e.g. ‘genera el logo’), compose one self-contained visual prompt using the request and agreed visual details and call ss_images_generate directly. Keep the subject, medium, composition, exact lettering and exclusions where relevant. Never send paths, secrets, unrelated context or raw history. Don't ask the user to confirm or copy and paste the prompt. If they only want a draft, give it as ordinary text.",
  `A legacy explicit ‘${SUBMIT}’ submission (or ‘Generate the image with this prompt:’) uses its supplied prompt verbatim: call ss_images_generate with no arguments; the host already has the body. ‘Sí’, ‘me gusta’, answers to design questions and earlier drafts are not generation orders by themselves. If the request depends on a missing image or crucial detail, ask for it instead of assuming or falling back to text generation.`,
  "StelaShell has a short built-in product description (also SS as the project subject in its own checkout). For other unexplained references, ask rather than guess. Never use ss_images_generate to send history or attachments. Generating a new image with selected visual references and editing a selected photo are separate actions. Do not retry, use bash, or fall back to another provider. Saving a PNG requires separate approval of an actual preview."
];

/** Only this standalone live submission authorizes generation; a quoted example or plain ‘yes’ does not. */
export function submittedPrompt(raw: string): string|undefined {
  const body = submissionBody(raw);
  if (body === undefined) return;
  // Obvious references are not visual content. Don't try to grade a prompt by length or invent missing details.
  const words = body.toLowerCase().replace(/[.!]+$/u, "").trim();
  if (!words || /^(?:sí|si|yes|ok|me gusta|lo mismo|como antes|same as (?:above|before)|as above)$/u.test(words) ||
      /^(?:(?:usa|usar|use|utiliza)\s+)?(?:el (?:anterior|mismo)|ese|este|el (?:prompt|borrador) anterior|(?:the )?(?:previous|last|same)|that)(?:\s+(?:prompt|borrador|anterior|draft|one))?$/u.test(words)) return;
  return body;
}

/** Optional editor convenience, never a grant. Only copy a single unambiguous, visible, bounded block. */
export function offeredSubmission(text: string, limit: number): string|undefined {
  const parts = text.split("```");
  if (parts.length !== 3) return;
  const block = /^(?:text)?\r?\n([\s\S]+)\r?\n$/u.exec(parts[1])?.[1].trim();
  if (!block || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]|\r(?!\n)/u.test(block)) return;
  const prompt = submittedPrompt(block);
  if (prompt && Buffer.byteLength(prompt) <= limit) return block;
}
