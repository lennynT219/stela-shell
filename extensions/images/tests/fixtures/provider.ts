// Offline only: the model deliberately attempts save even for non-approval messages.
import {createHash} from "node:crypto";
import {createAssistantMessageEventStream, getCurrentSystemPrompt} from "@earendil-works/pi-ai";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
export default function provider(pi: ExtensionAPI) {
  let serial = 0;
  pi.registerProvider("ss-images-fixture", {
    baseUrl: "http://127.0.0.1:1/unused",
    apiKey: "fixture-only",
    api: "ss-images-fixture-api",
    models: [{
      id: "fixture",
      name: "Fixture",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 32000,
      maxTokens: 2048,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
    }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const messages = context.messages as any[], user = messages.findLastIndex(m => m.role === "user"),
              turn = messages.slice(user + 1);
        const p = messages[user]?.content,
              raw = typeof p === "string" ? p : p?.find((b: any) => b.type === "text")?.text ?? "";
        // Script the conversation only if the real Pi provider prompt actually contains the planning rules.
        const rules = getCurrentSystemPrompt(messages);
        let answer = "";
        if (raw === "Quiero una portada para mi cuento.")
          answer = rules.includes("Ask one or two concrete questions") ?
            "¿Qué debería verse y qué emoción quieres transmitir?" : "MISSING_PLANNING_RULE";
        if (raw === "Un faro, con calma nocturna. Sin letras.")
          answer = rules.includes("Don't ask the user to confirm or copy and paste the prompt") ?
            "Portada vertical: faro a la luz de la luna, mar en calma. Sin letras." : "MISSING_DRAFT_RULE";
        if (raw === "Inspecciona el contexto sintético.") {
          const images = messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === "image");
          answer = JSON.stringify({images: images.map(b => createHash("sha256").update(Buffer.from(b.data,"base64")).digest("hex")),
            privatePrompt: JSON.stringify(messages).includes("REF-FIXTURE-PRIVADO")});
        }
        const contextual = raw.startsWith("PNG actual seleccionado con una vista previa disponible (");
        const guided = contextual && rules.includes("base:'preview'") && raw.endsWith("Traslada el acabado de la muestra al dibujo anterior.");
        if (contextual && !guided) answer = "No se solicitó editar.";
        const tool = answer || turn.some(m => m.role === "toolResult") ? null :
            guided ? "ss_images_edit" :
            /^Solicitud local de generación con referencias \(/u.test(raw) ? "ss_images_generate_with_references" :
            /^(?:Solicitud local de edición de foto \(|Haz la luna|Corrige la vista)/u.test(raw) ? "ss_images_edit" :
            /^Genera/.test(raw)                              ? "ss_images_generate" :
                                                               "ss_images_save";
        const b = tool ? {
          type: "toolCall",
          id: `fixture-${++serial}`,
          name: tool,
          arguments: guided ? {base:"preview"} : tool === "ss_images_generate" ? {prompt: raw === "Genera la portada" ?
            "Portada vertical: faro a la luz de la luna, mar en calma. Tinta azul. Sin letras." : raw} : {}
        } :
                         {type: "text", text: answer || "Fin de la prueba."};
        const m: any = {
          role: "assistant",
          content: [b],
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          stopReason: tool ? "toolUse" : "stop",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}
          }
        };
        stream.push({type: "start", partial: m});
        if (tool) {
          stream.push({type: "toolcall_start", contentIndex: 0, partial: m});
          stream.push({type: "toolcall_end", contentIndex: 0, toolCall: b as any, partial: m});
        } else {
          stream.push({type: "text_start", contentIndex: 0, partial: m});
          stream.push({type: "text_delta", contentIndex: 0, delta: b.text!, partial: m});
          stream.push({type: "text_end", contentIndex: 0, content: b.text!, partial: m});
        }
        stream.push({type: "done", reason: m.stopReason, message: m});
        stream.end();
      });
      return stream;
    }
  });
}
