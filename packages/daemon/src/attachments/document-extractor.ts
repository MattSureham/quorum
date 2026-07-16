import type { MessageAttachment } from "@quorum/protocol";
import { DOMParser } from "@xmldom/xmldom";
import type { Readable } from "node:stream";
import type { Entry, ZipFile } from "yauzl";

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
const MAX_DOCX_DOCUMENT_XML_BYTES = 8_000_000;

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
  const dataUrl = attachment.dataUrl ?? "";
  if (!dataUrl.startsWith(prefix)) {
    throw new Error(`${attachment.name} has a mismatched data URL MIME type`);
  }
  const encoded = dataUrl.slice(prefix.length);
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
    const extracted: ExtractedDocumentText = attachment.mimeType === PDF_MIME_TYPE
      ? await withTimeout(extractPdf(bytes), EXTRACTION_TIMEOUT_MS, `${attachment.name} text extraction timed out`)
      : await withAbortableTimeout(
        (signal) => extractDocx(bytes, signal),
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

async function extractDocx(bytes: Uint8Array, signal: AbortSignal): Promise<ExtractedDocumentText> {
  const documentXml = await readAndValidateDocxArchive(bytes, signal);
  if (signal.aborted) throw abortReason(signal);
  return { text: extractDocxText(documentXml) };
}

async function readAndValidateDocxArchive(bytes: Uint8Array, signal: AbortSignal): Promise<Buffer> {
  const { fromBuffer } = await import("yauzl");
  return new Promise<Buffer>((resolve, reject) => {
    let activeStream: Readable | undefined;
    let openedZipfile: ZipFile | undefined;
    let settled = false;
    const finishFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      activeStream?.destroy();
      try { openedZipfile?.close(); } catch { /* already closed */ }
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = () => finishFailure(abortReason(signal));
    if (signal.aborted) {
      finishFailure(abortReason(signal));
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    // validateEntrySizes is deliberately disabled: forged central-directory
    // sizes are treated only as an early rejection hint. The stream counters
    // below enforce limits against bytes actually produced by DEFLATE.
    fromBuffer(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: false }, (openError, zipfile) => {
      if (settled) {
        try { zipfile?.close(); } catch { /* already closed */ }
        return;
      }
      if (openError || !zipfile) {
        finishFailure(openError ?? new Error("could not open DOCX archive"));
        return;
      }
      openedZipfile = zipfile;
      let entries = 0;
      let totalDeclaredBytes = 0;
      let totalActualBytes = 0;
      let hasContentTypes = false;
      let documentXml: Buffer | undefined;
      zipfile.on("error", finishFailure);
      zipfile.on("entry", (entry: Entry) => {
        if (settled) return;
        entries += 1;
        totalDeclaredBytes += entry.uncompressedSize;
        if (entries > MAX_DOCX_ARCHIVE_ENTRIES) {
          finishFailure(new Error(`DOCX archive exceeds ${MAX_DOCX_ARCHIVE_ENTRIES} entries`));
          return;
        }
        if (entry.uncompressedSize > MAX_DOCX_ENTRY_BYTES) {
          finishFailure(new Error(`DOCX entry exceeds the ${MAX_DOCX_ENTRY_BYTES / 1_000_000} MB declared expanded-size limit`));
          return;
        }
        if (totalDeclaredBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
          finishFailure(new Error(`DOCX archive exceeds the ${MAX_DOCX_UNCOMPRESSED_BYTES / 1_000_000} MB declared expanded-size limit`));
          return;
        }
        if (entry.fileName === "[Content_Types].xml") hasContentTypes = true;
        if (entry.fileName.endsWith("/")) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (settled) {
            stream?.destroy();
            return;
          }
          if (streamError || !stream) {
            finishFailure(streamError ?? new Error(`could not read DOCX entry ${entry.fileName}`));
            return;
          }
          activeStream = stream;
          let entryActualBytes = 0;
          const captureDocument = entry.fileName === "word/document.xml";
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => {
            if (settled) return;
            const data = Buffer.from(chunk);
            entryActualBytes += data.byteLength;
            totalActualBytes += data.byteLength;
            if (entryActualBytes > MAX_DOCX_ENTRY_BYTES) {
              finishFailure(new Error(`DOCX entry exceeds the ${MAX_DOCX_ENTRY_BYTES / 1_000_000} MB actual expanded-size limit`));
              return;
            }
            if (totalActualBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
              finishFailure(new Error(`DOCX archive exceeds the ${MAX_DOCX_UNCOMPRESSED_BYTES / 1_000_000} MB actual expanded-size limit`));
              return;
            }
            if (captureDocument) {
              if (entryActualBytes > MAX_DOCX_DOCUMENT_XML_BYTES) {
                finishFailure(new Error(`DOCX main document XML exceeds the ${MAX_DOCX_DOCUMENT_XML_BYTES / 1_000_000} MB actual expanded-size limit`));
                return;
              }
              chunks.push(data);
            }
          });
          stream.on("error", finishFailure);
          stream.on("end", () => {
            if (settled) return;
            activeStream = undefined;
            if (captureDocument) documentXml = Buffer.concat(chunks, entryActualBytes);
            zipfile.readEntry();
          });
        });
      });
      zipfile.on("end", () => {
        if (settled) return;
        if (!hasContentTypes || !documentXml) {
          finishFailure(new Error("ZIP container is missing required DOCX document parts"));
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(documentXml);
      });
      zipfile.readEntry();
    });
  });
}

function extractDocxText(documentXml: Buffer): string {
  const xml = documentXml.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("DOCX XML declarations with entities are not allowed");
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => errors.push(String(message)),
      fatalError: (message) => errors.push(String(message)),
    },
  }).parseFromString(xml, "application/xml");
  if (!document?.documentElement || errors.length) {
    throw new Error(`invalid DOCX document XML${errors[0] ? `: ${errors[0]}` : ""}`);
  }

  const output: string[] = [];
  const visit = (node: any): void => {
    const localName = String(node.localName ?? node.nodeName ?? "").split(":").pop();
    if (localName === "t") {
      output.push(node.textContent ?? "");
      return;
    }
    if (localName === "tab") {
      output.push("\t");
      return;
    }
    if (localName === "br" || localName === "cr") {
      output.push("\n");
      return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
    if (localName === "p") output.push("\n\n");
    else if (localName === "tc") output.push("\t");
    else if (localName === "tr") output.push("\n");
  };
  visit(document.documentElement);
  return output.join("");
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("document extraction aborted");
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

async function withAbortableTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), timeoutMs);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
