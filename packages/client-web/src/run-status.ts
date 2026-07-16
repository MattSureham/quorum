import type { RoomEvent } from "@quorum/protocol";

const terminalTurnTypes = new Set<RoomEvent["type"]>([
  "turn_completed",
  "turn_failed",
  "turn_cancelled",
]);

export interface LatestTurnLifecycle {
  started?: RoomEvent;
  terminal?: RoomEvent;
  interrupt?: RoomEvent;
  active: boolean;
  stopping: boolean;
}

function turnIdOf(event: RoomEvent): string | undefined {
  const body = event.body as { turnId?: unknown } | undefined;
  const value = event.turnId ?? body?.turnId;
  return typeof value === "string" && value ? value : undefined;
}

/** Project only the newest turn so older failures cannot mask newer activity. */
export function latestTurnLifecycleAfter(events: RoomEvent[], seq: number): LatestTurnLifecycle {
  let started: RoomEvent | undefined;
  let terminal: RoomEvent | undefined;
  let interrupt: RoomEvent | undefined;
  let fallbackTerminal: RoomEvent | undefined;

  for (const event of events) {
    if (event.seq <= seq) continue;
    if (event.type === "turn_started") {
      started = event;
      terminal = undefined;
      interrupt = undefined;
      continue;
    }
    if (terminalTurnTypes.has(event.type)) {
      fallbackTerminal = event;
      if (!started || turnIdOf(event) === turnIdOf(started)) terminal = event;
      continue;
    }
    if (event.type === "interrupt" && started && (!event.turnId || event.turnId === turnIdOf(started))) {
      interrupt = event;
    }
  }

  if (!started) terminal = fallbackTerminal;
  const active = !!started && !terminal;
  return { started, terminal, interrupt, active, stopping: active && !!interrupt };
}

export function latestTerminalTurnAfter(events: RoomEvent[], seq: number): RoomEvent | undefined {
  return latestTurnLifecycleAfter(events, seq).terminal;
}
