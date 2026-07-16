export interface PendingSessionCreate {
  requestId: string;
  roomId: string;
}

export function matchesSessionCreateResponse(
  pending: PendingSessionCreate | undefined,
  response: { requestId?: string; roomId: string },
): boolean {
  if (!pending) return false;
  return response.requestId
    ? response.requestId === pending.requestId
    : response.roomId === pending.roomId;
}

export function matchesSessionCreateError(
  pending: PendingSessionCreate | undefined,
  requestId?: string,
): boolean {
  return !!pending && !!requestId && requestId === pending.requestId;
}
