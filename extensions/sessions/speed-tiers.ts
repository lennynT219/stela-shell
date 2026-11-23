export type Tier = { id: string; name: "Fast" | "Ultrafast" };
export type Catalog = Tier[] | undefined; // []: no advertised option; undefined: no usable receipt
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Both services advertise structured tiers. Never infer one from a model ID, a legacy flag or a default. */
export function advertisedTiers(value: unknown): Catalog {
  if (value == null) return [];
  if (!Array.isArray(value)) return undefined;
  const tiers: Tier[] = [];
  for (const t of value) {
    if (!record(t) || typeof t.id !== "string" || typeof t.name !== "string") continue;
    const name = t.name.toLowerCase();
    if (name !== "fast" && name !== "ultrafast") continue;
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(t.id) || ["default", "auto", "flex"].includes(t.id)) continue;
    const label = name === "fast" ? "Fast" : "Ultrafast";
    if (tiers.some(existing => existing.id === t.id || existing.name === label)) return undefined;
    tiers.push({ id: t.id, name: label });
  }
  return tiers;
}
