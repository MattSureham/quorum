export function canSendComposer(
  connected: boolean,
  text: string,
  attachmentCount: number,
  pendingAttachmentReads: number,
): boolean {
  return connected && pendingAttachmentReads === 0 && (!!text.trim() || attachmentCount > 0);
}

/** Resolve the base list only when an async attachment read completes. */
export function appendToLatest<T>(readLatest: () => readonly T[], additions: readonly T[]): T[] {
  return [...readLatest(), ...additions];
}
