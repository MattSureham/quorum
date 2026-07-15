import type { MessageAttachment } from "@quorum/protocol";

export const PDF_MIME_TYPE = "application/pdf";
export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_ATTACHMENT_COUNT = 6;
export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_DOCUMENT_BYTES = 10_000_000;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20_000_000;
export const MAX_EXTRACTED_DOCUMENT_CHARS = 120_000;
export const MAX_TOTAL_EXTRACTED_DOCUMENT_CHARS = 160_000;

const EXTRACTION_TIMEOUT_MS = 20_000;
const MAX_DOCX_ARCHIVE_ENTRIES = 2_000;
const MAX_DOCX_ENTRY_BYTES = 25_000_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 50_000_000;

interface ExtractedDocumentText {
  text: string;
  pageCount?: number;
  warning?: string;
}

export function isDocumentAttachment(attachment: Pick<MessageAttachment, "mimeType">): boolean {
  return attachment.mimeType === PDF_MIME_TYPE || attachment.mimeType === DOCX_MIME_TYPE;
}

export async function prepareMessageAttachments(attachments: MessageAttachment[]): Promise<MessageAttachment[]> {
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`use at most ${MAX_ATTACHMENT_COUNT} attachments`);
  }

  const decoded: Array<{ attachment: MessageAttachment; bytes: Uint8Array }> = [];
  let totalBytes = 0;
  for (const attachment of attachments) {
    const bytes = decodeAttachment(attachment);
    const maxBytes = isDocumentAttachment(attachment) ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
    if (bytes.byteLength > maxBytes) {
      throw new Error(`${attachment.name} exceeds the ${Math.floor(maxBytes / 1_000_000)} MB file limit`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("attachments exceed the 20 MB total limit");
    }
    decoded.push({ attachment: { ...attachment, sizeBytes: bytes.byteLength }, bytes });
  }

  const prepared: MessageAttachment[] = [];
  let totalExtractedCharacters = 0;
  for (const { attachment, bytes } of decoded) {
    const normalized = attachment;
    if (isDocumentAttachment(normalized)) {
      const remainingCharacters = Math.max(0, MAX_TOTAL_EXTRACTED_DOCUMENT_CHARS - totalExtractedCharacters);
      const document = await extractDocument(
        normalized,
        bytes,
        Math.min(MAX_EXTRACTED_DOCUMENT_CHARS, remainingCharacters),
      );
      totalExtractedCharacters += document.extraction?.includedCharacters ?? 0;
      prepared.push(document);
    } else {
      prepared.push(normalized);
    }
  }
  return prepared;
}

function decodeAttachment(attachment: MessageAttachment): Uint8Array {
  const prefix = `data:${attachment.mimeType};base64,`;
  if (!attachment.dataUrl.startsWith(prefix)) {
    throw new Error(`${attachment.name} has a mismatched data URL MIME type`);
  }
  const encoded = attachment.dataUrl.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error(`${attachment.name} has invalid base64 data`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (attachment.sizeBytes !== undefined && attachment.sizeBytes !== bytes.byteLength) {
    throw new Error(`${attachment.name} size does not match its encoded data`);
  }
  return bytes;
}

async function extractDocument(attachment: MessageAttachment, bytes: Uint8Array, maxCharacters: number): Promise<MessageAttachment> {
  try {
    assertDocumentSignature(attachment, bytes);
    const extracted: ExtractedDocumentText = await withTimeout(
      attachment.mimeType === PDF_MIME_TYPE ? extractPdf(bytes) : extractDocx(bytes),
      EXTRACTION_TIMEOUT_MS,
      `${attachment.name} text extraction timed out`,
    );
    const normalizedText = normalizeText(extracted.text);
    const sourceCharacters = normalizedText.length;
    if (!sourceCharacters) {
      return {
        ...attachment,
        extraction: {
          status: "empty",
          sourceCharacters: 0,
          includedCharacters: 0,
          ...(extracted.pageCount ? { pageCount: extracted.pageCount } : {}),
          warning: attachment.mimeType === PDF_MIME_TYPE
            ? "No embedded text was found. This may be a scanned PDF; OCR is not available yet."
            : "No readable document text was found.",
        },
      };
    }

    const text = truncateAtBoundary(normalizedText, maxCharacters);
    const truncated = text.length < sourceCharacters;
    const parserWarning = extracted.warning?.trim();
    return {
      ...attachment,
      ...(text ? { extractedText: text } : {}),
      extraction: {
        status: truncated ? "truncated" : "ready",
        sourceCharacters,
        includedCharacters: text.length,
        ...(extracted.pageCount ? { pageCount: extracted.pageCount } : {}),
        ...((truncated || parserWarning) ? {
          warning: [
            truncated ? `Only the first ${text.length.toLocaleString("en-US")} of ${sourceCharacters.toLocaleString("en-US")} characters were included.` : "",
            parserWarning ?? "",
          ].filter(Boolean).join(" ").slice(0, 500),
        } : {}),
      },
    };
  } catch (error) {
    return {
      ...attachment,
      extraction: {
        status: "failed",
        sourceCharacters: 0,
        includedCharacters: 0,
        warning: `Could not extract document text: ${safeErrorMessage(error)}`,
      },
    };
  }
}

function assertDocumentSignature(attachment: MessageAttachment, bytes: Uint8Array): void {
  if (attachment.mimeType === PDF_MIME_TYPE) {
    const header = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1_024))).toString("latin1");
    if (!header.includes("%PDF-")) throw new Error("file signature is not a PDF");
    return;
  }
  const zipSignature = bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
  if (!zipSignature) {
    throw new Error("file signature is not a DOCX/ZIP container");
  }
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocumentText> {
  const { extractText } = await import("unpdf");
  const result = await extractText(Uint8Array.from(bytes), { mergePages: true });
  return { text: result.text, pageCount: result.totalPages };
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractedDocumentText> {
  await validateDocxArchive(bytes);
  const imported = await import("mammoth");
  const mammoth = imported.default ?? imported;
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const warnings = result.messages
    .filter((message) => message.type === "warning")
    .map((message) => message.message)
    .join(" ");
  return { text: result.value, ...(warnings ? { warning: warnings } : {}) };
}

async function validateDocxArchive(bytes: Uint8Array): Promise<void> {
  const { fromBuffer } = await import("yauzl");
  await new Promise<void>((resolve, reject) => {
    fromBuffer(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(openError ?? new Error("could not open DOCX archive"));
        return;
      }
      let settled = false;
      let entries = 0;
      let totalUncompressedBytes = 0;
      let hasContentTypes = false;
      let hasMainDocument = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        try { zipfile.close(); } catch { /* already closed */ }
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      zipfile.on("error", fail);
      zipfile.on("entry", (entry) => {
        entries += 1;
        totalUncompressedBytes += entry.uncompressedSize;
        if (entries > MAX_DOCX_ARCHIVE_ENTRIES) {
          fail(new Error(`DOCX archive exceeds ${MAX_DOCX_ARCHIVE_ENTRIES} entries`));
          return;
        }
        if (entry.uncompressedSize > MAX_DOCX_ENTRY_BYTES) {
          fail(new Error(`DOCX entry exceeds the ${MAX_DOCX_ENTRY_BYTES / 1_000_000} MB expanded-size limit`));
          return;
        }
        if (totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
          fail(new Error(`DOCX archive exceeds the ${MAX_DOCX_UNCOMPRESSED_BYTES / 1_000_000} MB expanded-size limit`));
          return;
        }
        if (entry.fileName === "[Content_Types].xml") hasContentTypes = true;
        if (entry.fileName === "word/document.xml") hasMainDocument = true;
        zipfile.readEntry();
      });
      zipfile.on("end", () => {
        if (settled) return;
        if (!hasContentTypes || !hasMainDocument) {
          fail(new Error("ZIP container is missing required DOCX document parts"));
          return;
        }
        settled = true;
        resolve();
      });
      zipfile.readEntry();
    });
  });
}

function normalizeText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function truncateAtBoundary(text: string, maxCharacters: number): string {
  if (maxCharacters <= 0) return "";
  if (text.length <= maxCharacters) return text;
  const prefix = text.slice(0, maxCharacters);
  const boundary = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf(". "), prefix.lastIndexOf("。"));
  return (boundary >= maxCharacters * 0.8 ? prefix.slice(0, boundary + 1) : prefix).trimEnd();
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300) || "unknown parser error";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
