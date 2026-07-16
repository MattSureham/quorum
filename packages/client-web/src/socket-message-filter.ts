interface RoomScopedSocketMessage {
  t: string;
  event?: { roomId?: unknown };
  room?: { id?: unknown };
}

/** Reject messages from replaced sockets and late room snapshots/events. */
export function shouldHandleSocketMessage(
  sourceSocket: unknown,
  currentSocket: unknown,
  message: RoomScopedSocketMessage,
  activeRoomId: string,
): boolean {
  if (sourceSocket !== currentSocket) return false;
  if (message.t === "event") return message.event?.roomId === activeRoomId;
  if (message.t === "snapshot" || message.t === "session_continued") {
    return !activeRoomId || message.room?.id === activeRoomId;
  }
  return true;
}
