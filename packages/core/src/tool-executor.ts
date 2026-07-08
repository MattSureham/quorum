import type { ToolCallRequest, ToolCallResult } from "@quorum/protocol";

export interface ToolExecutionContext {
  sessionId: string;
  turnId?: string;
  speakerId?: string;
  workspacePath?: string;
}

export interface ToolExecutor {
  execute(req: ToolCallRequest & { callId: string }, ctx: ToolExecutionContext): Promise<ToolCallResult>;
}
