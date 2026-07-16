import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import {
  DOCX_MIME_TYPE,
  MAX_EXTRACTED_DOCUMENT_CHARS,
  PDF_MIME_TYPE,
  prepareMessageAttachments,
} from "./document-extractor.js";

const DOCX_BASE64 = "UEsDBBQAAAAIAAKO71x5bjPX6AAAAK0BAAATABwAW0NvbnRlbnRfVHlwZXNdLnhtbFVUCQADU1dXalNXV2p1eAsAAQT1AQAABBQAAAB9UMlOwzAQ/RVrrihx4IAQitMDyxE4lA8Y2ZPEqjd53NL+PU5bekCF48xb9frV3juxo8w2BgW3bQeCgo7GhknB5/q1eQDBBYNBFwMpOBDDaujXh0QsqjawgrmU9Cgl65k8chsThYqMMXss9cyTTKg3OJG867p7qWMoFEpTFg8Y+mcaceuKeNnX96lHJscgnk7EJUsBpuSsxlJxuQvmV0pzTmir8sjh2Sa+qQSQVxMW5O+As+69DpOtIfGBubyhryz5FbORJuqtr8r2f5srPeM4Wk0X/eKWctTEXBf3rr0gHm346S+Pcw/fUEsDBAoAAAAAAAKO71wAAAAAAAAAAAAAAAAGABwAX3JlbHMvVVQJAANTV1dqU1dXanV4CwABBPUBAAAEFAAAAFBLAwQUAAAACAACju9cm/036q0AAAApAQAACwAcAF9yZWxzLy5yZWxzVVQJAANTV1dqU1dXanV4CwABBPUBAAAEFAAAAI3POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBAoAAAAAAAKO71wAAAAAAAAAAAAAAAAFABwAd29yZC9VVAkAA1NXV2pTV1dqdXgLAAEE9QEAAAQUAAAAUEsDBBQAAAAIAAKO71y5oAWDxQAAACIBAAARABwAd29yZC9kb2N1bWVudC54bWxVVAkAA1NXV2pTV1dqdXgLAAEE9QEAAAQUAAAAbY/NTsQwDIRfJcqdpnBAqGq7BxBXQIDE1SSmrWjsyE7p7tuTLAckxGUs/8yncX84xtV8oejCNNjLprUGyXNYaBrs68v9xY01moECrEw42BOqPYz93gX2W0TKpgBIu32wc86pc079jBG04YRUdh8sEXJpZXI7S0jCHlULP67uqm2vXYSFbEW+czjVmqpIlTw+bSxbNHcPt28Gj1nA55LUFNKn9q5eVJWzpr/mZ/RMwSQQmATS3PzrUPT5Udx58BPB/b43fgNQSwECHgMUAAAACAACju9ceW4z1+gAAACtAQAAEwAYAAAAAAABAAAApIEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFVUBQADU1dXanV4CwABBPUBAAAEFAAAAFBLAQIeAwoAAAAAAAKO71wAAAAAAAAAAAAAAAAGABgAAAAAAAAAEADtQTUBAABfcmVscy9VVAUAA1NXV2p1eAsAAQT1AQAABBQAAABQSwECHgMUAAAACAACju9cm/036q0AAAApAQAACwAYAAAAAAABAAAApIF1AQAAX3JlbHMvLnJlbHNVVAUAA1NXV2p1eAsAAQT1AQAABBQAAABQSwECHgMKAAAAAAACju9cAAAAAAAAAAAAAAAABQAYAAAAAAAAABAA7UFnAgAAd29yZC9VVAUAA1NXV2p1eAsAAQT1AQAABBQAAABQSwECHgMUAAAACAACju9cuaAFg8UAAAAiAQAAEQAYAAAAAAABAAAApIGmAgAAd29yZC9kb2N1bWVudC54bWxVVAUAA1NXV2p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAUABQCYAQAAtgMAAAAA";

function makePdf(text: string): Buffer {
  const content = text ? `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET` : "";
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function dataAttachment(id: string, name: string, mimeType: string, bytes: Buffer) {
  return {
    id,
    name,
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    sizeBytes: bytes.length,
  };
}

function forgeDocxExpandedSize(base64: string, expandedBytes: number): Buffer {
  const bytes = Buffer.from(base64, "base64");
  const centralHeader = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let cursor = 0;
  while ((cursor = bytes.indexOf(centralHeader, cursor)) >= 0) {
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (name === "word/document.xml") {
      bytes.writeUInt32LE(expandedBytes, cursor + 24);
      return bytes;
    }
    cursor += 46 + nameLength;
  }
  throw new Error("DOCX fixture has no central-directory document entry");
}

function makeDeflatedZip(entries: Array<{ name: string; content: Buffer; declaredSize?: number }>): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.content, { level: 9 });
    const declaredSize = entry.declaredSize ?? entry.content.byteLength;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.byteLength, 18);
    local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    const localRecord = Buffer.concat([local, name, compressed]);
    localRecords.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.byteLength, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralRecords.push(Buffer.concat([central, name]));
    localOffset += localRecord.byteLength;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

describe("document attachment extraction", () => {
  it("extracts embedded text and page count from PDF", async () => {
    const [attachment] = await prepareMessageAttachments([
      dataAttachment("pdf", "sample.pdf", PDF_MIME_TYPE, makePdf("Quorum PDF extraction works")),
    ]);

    expect(attachment?.extraction).toMatchObject({ status: "ready", pageCount: 1 });
    expect(attachment?.extractedText).toContain("Quorum PDF extraction works");
  });

  it("extracts paragraph text from DOCX", async () => {
    const bytes = Buffer.from(DOCX_BASE64, "base64");
    const [attachment] = await prepareMessageAttachments([
      dataAttachment("docx", "sample.docx", DOCX_MIME_TYPE, bytes),
    ]);

    expect(attachment?.extraction?.status).toBe("ready");
    expect(attachment?.extractedText).toBe("Quorum DOCX extraction works\n\nSecond paragraph.");
  });

  it("reports empty scanned-style PDFs and malformed documents without inventing text", async () => {
    const empty = await prepareMessageAttachments([
      dataAttachment("empty", "scan.pdf", PDF_MIME_TYPE, makePdf("")),
    ]);
    const malformedBytes = Buffer.from("PK-not-a-docx");
    const malformed = await prepareMessageAttachments([
      dataAttachment("bad", "bad.docx", DOCX_MIME_TYPE, malformedBytes),
    ]);
    const emptyZipBytes = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    const emptyContainer = await prepareMessageAttachments([
      dataAttachment("empty-docx", "empty.docx", DOCX_MIME_TYPE, emptyZipBytes),
    ]);

    expect(empty[0]?.extraction).toMatchObject({ status: "empty", includedCharacters: 0 });
    expect(empty[0]?.extraction?.warning).toContain("OCR");
    expect(malformed[0]?.extraction?.status).toBe("failed");
    expect(malformed[0]?.extractedText).toBeUndefined();
    expect(emptyContainer[0]?.extraction?.warning).toContain("required DOCX document parts");
  });

  it("rejects forged declared sizes before parsing", async () => {
    const bytes = makePdf("size check");
    await expect(prepareMessageAttachments([{
      ...dataAttachment("pdf", "sample.pdf", PDF_MIME_TYPE, bytes),
      sizeBytes: bytes.length + 1,
    }])).rejects.toThrow("size does not match");
  });

  it("rejects DOCX archives that claim unsafe expanded sizes", async () => {
    const bytes = forgeDocxExpandedSize(DOCX_BASE64, 30_000_000);
    const [attachment] = await prepareMessageAttachments([
      dataAttachment("bomb", "expanded.docx", DOCX_MIME_TYPE, bytes),
    ]);

    expect(attachment?.extraction?.status).toBe("failed");
    expect(attachment?.extraction?.warning).toContain("expanded-size limit");
    expect(attachment?.extractedText).toBeUndefined();
  });

  it("rejects actual DOCX expansion that exceeds forged small metadata", async () => {
    const oversizedXml = Buffer.from(
      `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>${"A".repeat(8_100_000)}</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = makeDeflatedZip([
      { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
      { name: "word/document.xml", content: oversizedXml, declaredSize: 1_024 },
    ]);
    expect(bytes.byteLength).toBeLessThan(100_000);

    const [attachment] = await prepareMessageAttachments([
      dataAttachment("bomb", "forged-small.docx", DOCX_MIME_TYPE, bytes),
    ]);

    expect(attachment?.extraction?.status).toBe("failed");
    expect(attachment?.extraction?.warning).toContain("actual expanded-size limit");
    expect(attachment?.extractedText).toBeUndefined();
  });

  it("keeps the prompt extraction ceiling explicit", () => {
    expect(MAX_EXTRACTED_DOCUMENT_CHARS).toBe(120_000);
  });
});
