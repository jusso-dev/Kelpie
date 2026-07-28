import net from "node:net";
import { UnavailableScanner, type EvidenceScanner, type ScanOutcome } from "./scanner";

const CHUNK_SIZE = 1024 * 1024;

/** ClamAV clamd `INSTREAM` client. See clamd protocol documentation. */
export class ClamAvScanner implements EvidenceScanner {
  readonly name = "clamav";

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 30_000,
  ) {}

  async scan(buffer: Buffer): Promise<ScanOutcome> {
    try {
      const response = await this.instream(buffer);
      return this.parseResponse(response);
    } catch (error) {
      return {
        verdict: "error",
        engine: this.name,
        detail: error instanceof Error ? error.message : "ClamAV scan failed",
      };
    }
  }

  private instream(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let response = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error("ClamAV scan timed out"));
      }, this.timeoutMs);

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      };

      socket.on("error", fail);
      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString("latin1");
      });
      socket.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        let offset = 0;
        while (offset < buffer.length) {
          const end = Math.min(offset + CHUNK_SIZE, buffer.length);
          const chunk = buffer.subarray(offset, end);
          const sizeHeader = Buffer.alloc(4);
          sizeHeader.writeUInt32BE(chunk.length, 0);
          socket.write(sizeHeader);
          socket.write(chunk);
          offset = end;
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
        socket.end();
      });
    });
  }

  private parseResponse(response: string): ScanOutcome {
    const clean = response.replace(/\0/g, "").trim();
    if (/OK$/.test(clean)) {
      return { verdict: "clean", engine: this.name, detail: clean };
    }
    const foundMatch = clean.match(/:\s*(.+?)\s+FOUND$/);
    if (foundMatch) {
      return {
        verdict: "malicious",
        engine: this.name,
        signature: foundMatch[1],
        detail: clean,
      };
    }
    return {
      verdict: "error",
      engine: this.name,
      detail: clean || "Unrecognised ClamAV response",
    };
  }
}

/** Reads env fresh each call so tests can point at a mock clamd per scenario. */
export function getConfiguredScanner(): EvidenceScanner {
  const host = process.env.CLAMAV_HOST?.trim();
  if (!host) return new UnavailableScanner();
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new ClamAvScanner(host, Number.isInteger(port) && port > 0 ? port : 3310);
}
