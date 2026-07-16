export function canSendComposer(
  connected: boolean,
  text: string,
  attachmentCount: number,
  pendingAttachmentReads: number,
): boolean {
  return connected && pendingAttachmentReads === 0 && (!!text.trim() || attachmentCount > 0);
}
