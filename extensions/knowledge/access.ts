import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { primaryActivity } from "../primary-activity.ts";

export type KnowledgeOwner = Pick<ExtensionContext, "cwd" | "sessionManager">;

/** Ephemeral authority only. A note, transcript or tool argument cannot prime it. */
export class KnowledgeAccess {
  private owner?: { manager: KnowledgeOwner["sessionManager"]; cwd: string; id: string };
  private human = false;
  private epoch = 0;
  private pending = new AbortController();

  start(ctx: KnowledgeOwner): void {
    this.stop();
    this.owner = { manager: ctx.sessionManager, cwd: ctx.cwd, id: ctx.sessionManager.getSessionId() };
  }

  invalidate(): void {
    this.epoch++;
    this.human = false;
    this.pending.abort();
    this.pending = new AbortController();
  }

  stop(): void {
    this.owner = undefined;
    this.invalidate();
  }

  input(ctx: KnowledgeOwner, source: string): void {
    if (this.owns(ctx) && (source === "interactive" || source === "rpc")) this.human = true;
  }

  private owns(ctx: KnowledgeOwner): boolean {
    const owner = this.owner;
    return !!owner && ctx.sessionManager === owner.manager && ctx.cwd === owner.cwd &&
      ctx.sessionManager.getSessionId() === owner.id;
  }

  claim(ctx: KnowledgeOwner, write: boolean): { signal: AbortSignal; valid(): boolean } | undefined {
    if (!this.owns(ctx)) return;
    // Writes require genuine local activity as well as separate backend authorization.
    // An authenticated peer may prime reads, but never supplies human write approval.
    const human = this.human;
    const peer = primaryActivity(ctx);
    if ((write && peer) || (!human && !peer)) return;
    const epoch = this.epoch;
    return {
      signal: this.pending.signal,
      valid: () => this.epoch === epoch && this.owns(ctx) &&
        (human ? this.human && (!write || !primaryActivity(ctx)) : peer?.valid() === true),
    };
  }
}
