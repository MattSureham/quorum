import type { ConductorContext, Moderator } from "@quorum/core";
import type { MessageBody } from "@quorum/protocol";

export interface ModeratorOptions {
  model: string;
  baseUrl?: string;   // OpenAI-compatible /chat/completions base
  apiKeyEnv?: string; // env var holding the key
}

/** Minimal shape of the chat-completions call we depend on (also lets tests inject). */
export type ModeratorFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ json(): Promise<unknown> }>;

const SYSTEM_PROMPT =
  "You are the moderator of a multi-party engineering room. Decide who should " +
  "speak next to move the discussion forward, or yield to the human when their " +
  "input is needed or the thread is resolved. Prefer not to pick the agent who " +
  'just spoke. Reply with compact JSON only: {"next":"<agentId|human>","reason":"<short>"}.';

/**
 * A moderator (SPEC §8 "moderated" policy) backed by an OpenAI-compatible chat
 * model. Reads the recent transcript + agent roster and names the next speaker.
 * Any failure — missing key, network error, unparseable reply — degrades to
 * yielding to the human, so the room never wedges on the moderator.
 * Lives in the daemon (network + env) so @quorum/core stays dependency-free.
 */
export function makeModelModerator(
  opts: ModeratorOptions,
  fetchImpl: ModeratorFetch = fetch as unknown as ModeratorFetch,
): Moderator {
  const base = opts.baseUrl ?? "https://api.openai.com/v1";
  const apiKeyEnv = opts.apiKeyEnv ?? "OPENAI_API_KEY";
  return async (ctx: ConductorContext) => {
    const agents = ctx.participants.filter((p) => p.kind === "agent");
    if (!agents.length) return { next: "human", reason: "no agents in the room" };

    const roster = agents.map((a) => (a.persona ? `${a.id} — ${a.persona}` : a.id)).join("\n");
    const transcript = ctx.recent
      .filter((e) => e.type === "message")
      .slice(-12)
      .map((e) => `${e.author.id} (${e.author.kind}): ${(e.body as MessageBody).text}`)
      .join("\n");
    const user =
      `Agents:\n${roster}\n\n` +
      `Recent messages:\n${transcript || "(none yet)"}\n\n` +
      `Last speaker: ${ctx.lastSpeakerId ?? "none"}.\n` +
      `Who should speak next? Pick an agent id above, or "human".`;

    try {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env[apiKeyEnv] ?? ""}`,
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: user },
          ],
        }),
      });
      const data = (await res.json()) as any;
      const content: string = data?.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(content) as { next?: unknown; reason?: unknown };
      const next = typeof parsed.next === "string" && parsed.next ? parsed.next : "human";
      const reason = typeof parsed.reason === "string" && parsed.reason ? parsed.reason : "moderator decision";
      return { next, reason };
    } catch (err) {
      return { next: "human", reason: `moderator unavailable (${err instanceof Error ? err.message : String(err)})` };
    }
  };
}
