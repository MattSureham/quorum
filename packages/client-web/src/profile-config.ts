export interface NormalizedCustomProfile {
  id: string;
  display: string;
  providerId: string;
  model?: string;
  role: string;
  vision: boolean;
}

export function normalizeStoredCustomProfile(value: unknown): NormalizedCustomProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.display !== "string") return undefined;
  const providerId = typeof item.providerId === "string" && item.providerId.trim()
    ? item.providerId.trim().toLowerCase()
    : "openai";
  return {
    id: item.id,
    display: item.display,
    providerId,
    model: typeof item.model === "string" ? item.model : undefined,
    role: typeof item.role === "string" ? item.role : "analysis model",
    vision: !!item.vision,
  };
}

export function canCreateCustomApiProfile(
  draft: { id: string; providerId: string },
  existingIds: Iterable<string>,
): boolean {
  const id = draft.id.trim().toLowerCase();
  const providerId = draft.providerId.trim().toLowerCase();
  return !!id && !!providerId && !new Set(existingIds).has(id);
}
