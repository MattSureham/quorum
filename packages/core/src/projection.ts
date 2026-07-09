import type { ParticipantDescriptor, MessageBody, ToolCallBody, CheckpointBody } from "@quorum/protocol";
import type { TurnInput } from "./types.js";

/** The room speaking-protocol injected into each agent turn. */
export function buildProtocol(self: ParticipantDescriptor, participants: ParticipantDescriptor[]): string {
  const others = participants.filter((p) => p.id !== self.id).map((p) => `${p.id}(${p.kind})`).join(", ");
  return [
    `You are "${self.id}" in a multi-party room.`,
    `Other participants: ${others || "(none yet)"}.`,
    `Rules:`,
    `- This is NOT a blocking prompt; nobody answers mid-turn questions. Act, or state your assumptions and proceed. Never end with "let me know if...".`,
    `- To address or rebut someone, begin your message with @their-id.`,
    `- To continue or rebut after others respond, call the room tool raise_hand with a one-line reason. Do not monologue across turns.`,
    `- Room tools: raise_hand (take the floor), hand_off (pass to another participant), request_review, read_room, post_note.`,
    `- Keep file edits minimal and explain them. Other participants and the human see your edits.`,
    `- End your turn when you've made your point or completed the step.`,
    self.persona ? `\nYour role: ${self.persona}` : "",
  ].join("\n");
}

/** Render the transcript delta + protocol into the prompt fed to an agent's native session. */
export function renderProjection(input: TurnInput): string {
  const lines = input.projection
    .map((e) => {
      const to = e.addressedTo?.length ? `\u2192${e.addressedTo.join(",")}` : "\u2192all";
      switch (e.type) {
        case "message":
          {
            const body = e.body as MessageBody;
            const attachments = body.attachments?.length
              ? `\n${body.attachments.map((item, index) => `  [image ${index + 1}: ${item.name} ${item.mimeType} ${item.dataUrl}]`).join("\n")}`
              : "";
            return `[t${e.seq} ${e.author.id}${to}] ${body.text}${attachments}`;
          }
        case "tool_call":
          return `[t${e.seq} ${e.author.id} tool:${(e.body as ToolCallBody).tool}]`;
        case "checkpoint": {
          const s = (e.body as CheckpointBody).stat;
          return `[t${e.seq} ${e.author.id} edited ${s.files} files (+${s.insertions} -${s.deletions})]`;
        }
        default:
          return null;
      }
    })
    .filter((x): x is string => x !== null)
    .join("\n");
  return `${input.protocol}\n\n--- transcript since your last turn ---\n${lines || "(room just started)"}\n--- end ---\n\nYour turn.`;
}
