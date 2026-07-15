import { spawn, execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { RoomEvent } from "@quorum/protocol";

const exec = promisify(execFile);
const sidecarName = process.platform === "win32" ? "quorum-sidecar.exe" : "quorum-sidecar";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_BASE64 = "UEsDBBQAAAAIAAKO71x5bjPX6AAAAK0BAAATABwAW0NvbnRlbnRfVHlwZXNdLnhtbFVUCQADU1dXalNXV2p1eAsAAQT1AQAABBQAAAB9UMlOwzAQ/RVrrihx4IAQitMDyxE4lA8Y2ZPEqjd53NL+PU5bekCF48xb9frV3juxo8w2BgW3bQeCgo7GhknB5/q1eQDBBYNBFwMpOBDDaujXh0QsqjawgrmU9Cgl65k8chsThYqMMXss9cyTTKg3OJG867p7qWMoFEpTFg8Y+mcaceuKeNnX96lHJscgnk7EJUsBpuSsxlJxuQvmV0pzTmir8sjh2Sa+qQSQVxMW5O+As+69DpOtIfGBubyhryz5FbORJuqtr8r2f5srPeM4Wk0X/eKWctTEXBf3rr0gHm346S+Pcw/fUEsDBAoAAAAAAAKO71wAAAAAAAAAAAAAAAAGABwAX3JlbHMvVVQJAANTV1dqU1dXanV4CwABBPUBAAAEFAAAAFBLAwQUAAAACAACju9cm/036q0AAAApAQAACwAcAF9yZWxzLy5yZWxzVVQJAANTV1dqU1dXanV4CwABBPUBAAAEFAAAAI3POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBAoAAAAAAAKO71wAAAAAAAAAAAAAAAAFABwAd29yZC9VVAkAA1NXV2pTV1dqdXgLAAEE9QEAAAQUAAAAUEsDBBQAAAAIAAKO71y5oAWDxQAAACIBAAARABwAd29yZC9kb2N1bWVudC54bWxVVAkAA1NXV2pTV1dqdXgLAAEE9QEAAAQUAAAAbY/NTsQwDIRfJcqdpnBAqGq7BxBXQIDE1SSmrWjsyE7p7tuTLAckxGUs/8yncX84xtV8oejCNNjLprUGyXNYaBrs68v9xY01moECrEw42BOqPYz93gX2W0TKpgBIu32wc86pc079jBG04YRUdh8sEXJpZXI7S0jCHlULP67uqm2vXYSFbEW+czjVmqpIlTw+bSxbNHcPt28Gj1nA55LUFNKn9q5eVJWzpr/mZ/RMwSQQmATS3PzrUPT5Udx58BPB/b43fgNQSwECHgMUAAAACAACju9ceW4z1+gAAACtAQAAEwAYAAAAAAABAAAApIEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFVUBQADU1dXanV4CwABBPUBAAAEFAAAAFBLAQIeAwoAAAAAAAKO71wAAAAAAAAAAAAAAAAGABgAAAAAAAAAEADtQTUBAABfcmVscy9VVAUAA1NXV2p1eAsAAQT1AQAABBQAAABQSwECHgMUAAAACAACju9cm/036q0AAAApAQAACwAYAAAAAAABAAAApIF1AQAAX3JlbHMvLnJlbHNVVAUAA1NXV2p1eAsAAQT1AQAABBQAAABQSwECHgMKAAAAAAACju9cAAAAAAAAAAAAAAAABQAYAAAAAAAAABAA7UFnAgAAd29yZC9VVAUAA1NXV2p1eAsAAQT1AQAABBQAAABQSwECHgMUAAAACAACju9cuaAFg8UAAAAiAQAAEQAYAAAAAAABAAAApIGmAgAAd29yZC9kb2N1bWVudC54bWxVVAUAA1NXV2p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAUABQCYAQAAtgMAAAAA";

function makePdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
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

interface Handshake {
  port: number;
  token: string;
  bootId: string;
  protocolVersion: number;
}

function readHandshake(proc: ReturnType<typeof spawn>): Promise<Handshake> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("bun sidecar handshake timed out")), 5_000);
    proc.stdout?.on("data", (chunk) => {
      buf += String(chunk);
      const line = buf.split("\n")[0]?.trim();
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line) as Handshake);
    });
    proc.once("error", reject);
    proc.once("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`bun sidecar exited early: ${code}`));
    });
  });
}

function roundTrip(handshake: Handshake): Promise<RoomEvent[]> {
  return new Promise((resolve, reject) => {
    const events: RoomEvent[] = [];
    let credentialSaved = false;
    const timer = setTimeout(() => reject(new Error("bun sidecar websocket timed out")), 15_000);
    const ws = new WebSocket(`ws://127.0.0.1:${handshake.port}?token=${handshake.token}`);
    ws.addEventListener("open", () => {
      const pdf = makePdf("Compiled PDF parser works");
      const docx = Buffer.from(DOCX_BASE64, "base64");
      ws.send(JSON.stringify({ t: "subscribe", roomId: "main", sinceSeq: 0 }));
      ws.send(JSON.stringify({
        t: "post_message",
        roomId: "main",
        text: "bun sidecar smoke",
        attachments: [
          {
            id: "smoke-pdf",
            name: "smoke.pdf",
            mimeType: "application/pdf",
            dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}`,
            sizeBytes: pdf.length,
          },
          {
            id: "smoke-docx",
            name: "smoke.docx",
            mimeType: DOCX_MIME_TYPE,
            dataUrl: `data:${DOCX_MIME_TYPE};base64,${DOCX_BASE64}`,
            sizeBytes: docx.length,
          },
        ],
      }));
      ws.send(JSON.stringify({
        t: "set_credential",
        roomId: "main",
        requestId: "bun-smoke-credential",
        providerId: "smoke-provider",
        envVar: "QUORUM_SMOKE_API_KEY",
        apiKey: "temporary-smoke-key-1357",
      }));
    });
    ws.addEventListener("message", (raw) => {
      const msg = JSON.parse(String(raw.data)) as any;
      if (msg.t === "snapshot") events.push(...msg.events);
      if (msg.t === "event") events.push(msg.event);
      if (msg.t === "credential_saved" && msg.requestId === "bun-smoke-credential") {
        credentialSaved = msg.provider?.configured === true && msg.provider?.apiKeyPreview === "...1357";
        if (JSON.stringify(msg).includes("temporary-smoke-key-1357")) {
          reject(new Error("credential response exposed the raw key"));
          return;
        }
      }
      const ok = events.some((event) =>
        event.type === "message" &&
        event.author.id === "echo" &&
        (event.body as any).text === "sidecar ready",
      );
      const documentReady = events.some((event) => {
        if (event.type !== "message" || event.author.kind !== "human") return false;
        const attachments = (event.body as any).attachments;
        return Array.isArray(attachments)
          && attachments.length === 2
          && attachments.every((attachment: any) => attachment.extraction?.status === "ready")
          && attachments[0]?.extractedText?.includes("Compiled PDF parser works")
          && attachments[1]?.extractedText?.includes("Quorum DOCX extraction works");
      });
      if (ok && credentialSaved && documentReady) {
        clearTimeout(timer);
        ws.close();
        resolve(events);
      }
    });
    ws.addEventListener("error", () => reject(new Error("websocket error")));
  });
}

await exec("tsx", ["scripts/build-sidecar-bun.ts"], { cwd: process.cwd() });

const dir = await mkdtemp(join(tmpdir(), "quorum-bun-sidecar-smoke-"));
const proc = spawn(resolve("dist-sidecar/bun", sidecarName), [], {
  cwd: process.cwd(),
  env: { ...process.env, QUORUM_DB_PATH: join(dir, "sidecar.sqlite") },
  stdio: ["ignore", "pipe", "inherit"],
});

try {
  const handshake = await readHandshake(proc);
  if (handshake.protocolVersion !== 2) throw new Error(`unexpected sidecar protocol ${handshake.protocolVersion}`);
  const events = await roundTrip(handshake);
  console.log(`bun sidecar smoke pass (${events.length} events, port ${handshake.port})`);
} finally {
  proc.kill("SIGTERM");
}
