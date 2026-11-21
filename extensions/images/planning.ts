// The chat model helps write the brief. No extra model, image runtime or project data is needed here.
export const SUBMIT = "Genera la imagen con este prompt:";
const submitLine = /^(?:Genera la imagen con este prompt|Generate the image with this prompt):\s*/iu;

export const planningRules = [
  "For a NEW image from text, help the user design the prompt for any subject in the existing chat, in their language. An ordinary image request (even ‘draw …’) starts a conversation, not a generation. No image tools while discussing the idea.",
  "Use what the user already told you. Ask one or two concrete questions at a time about the unresolved choices that would most change this image, then wait for the answer. Offer useful contrasting options if helpful. For a cover this might be audience and space for the title; for a scene, point of view or mood. Not a fixed questionnaire. Never ask again about supplied details. If the request is already clear, or the user says ‘you choose’, propose a finished draft without needless questions.",
  `Once ready, compose one self-contained visual prompt: describe what will be seen, the purpose/format, composition, style, light/color, exact lettering and exclusions only as relevant. Preserve agreed details and revisions. Do not add private information, files, or unrelated conversation. Show the final text in ONE fenced text block whose first line is ‘${SUBMIT}’ and whose remaining lines are the prompt (max 4096 UTF-8 bytes). Invite the user to edit and submit it, or tell you what to change. If they only want help writing a prompt, give the draft as plain text without a submission heading. Do not call a tool just because YOU drafted it.`,
  `Only call ss_images_generate after a direct user message beginning ‘${SUBMIT}’ (or ‘Generate the image with this prompt:’) followed by the visual prompt. Copy that message's full visual prompt verbatim. If it merely refers to a previous draft or still does not describe what to depict, ask for the missing detail or offer the complete draft again; do not guess. ‘Sí’, ‘me gusta’, answers to design questions and earlier drafts are not a generation order.`,
  "StelaShell has a short built-in product description (also SS as the project subject in its own checkout). For other unexplained references, ask rather than guess. Never use ss_images_generate to send history or attachments. Editing a selected photo is a separate action. Do not retry, use bash, or fall back to another provider. Saving a PNG requires separate approval of an actual preview."
];

/** Only this standalone live submission authorizes generation; a quoted example or plain ‘yes’ does not. */
export function submittedPrompt(raw: string): string|undefined {
  const input = raw.trim(), prefix = submitLine.exec(input);
  if (!prefix) return;
  const body = input.slice(prefix[0].length);
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
