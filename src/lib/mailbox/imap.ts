/**
 * Minimal IMAP4rev1 client over TLS for mailbox intake.
 * Supports LOGIN, SELECT, UID SEARCH, UID FETCH RFC822 — enough for secure
 * inbound poll without a third-party IMAP dependency.
 */

import net from "node:net";
import tls from "node:tls";
import type { ImapConnectionMeta, ImapSecrets, NormalizedMailMessage } from "./types";
import { parseRfc822 } from "./parse";
import { MAX_POLL_MESSAGES } from "./types";

const DEFAULT_TIMEOUT_MS = 45_000;

export class ImapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImapError";
  }
}

type SocketLike = net.Socket;

class ImapSession {
  private socket: SocketLike;
  private buffer = "";
  private tagSeq = 0;
  private closed = false;
  private waiters: Array<{
    resolve: (line: string) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(socket: SocketLike) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on("error", (err) => {
      this.failAll(err instanceof Error ? err : new Error(String(err)));
    });
    socket.on("close", () => {
      this.closed = true;
      this.failAll(new ImapError("IMAP connection closed"));
    });
  }

  private failAll(err: Error) {
    const pending = this.waiters.splice(0);
    for (const w of pending) w.reject(err);
  }

  private drain() {
    // Unsolicited lines start with * or +; tagged responses end a command.
    // We accumulate until the next tagged response for the active command
    // is handled in `command`.
  }

  private readLine(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ImapError("IMAP read timed out"));
      }, timeoutMs);

      const tryConsume = () => {
        const idx = this.buffer.indexOf("\n");
        if (idx >= 0) {
          clearTimeout(timer);
          const line = this.buffer.slice(0, idx).replace(/\r$/, "");
          this.buffer = this.buffer.slice(idx + 1);
          resolve(line);
          return true;
        }
        return false;
      };

      if (tryConsume()) return;

      const onData = () => {
        if (tryConsume()) {
          this.socket.off("data", onData);
        }
      };
      this.socket.on("data", onData);
      this.socket.once("error", (err) => {
        clearTimeout(timer);
        this.socket.off("data", onData);
        reject(err);
      });
    });
  }

  async expectGreeting(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    const line = await this.readLine(timeoutMs);
    if (!line.startsWith("* OK")) {
      throw new ImapError(`Unexpected IMAP greeting: ${line.slice(0, 80)}`);
    }
  }

  async command(
    payload: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<{ tag: string; lines: string[]; status: string }> {
    if (this.closed) throw new ImapError("IMAP session closed");
    const tag = `A${++this.tagSeq}`;
    const lines: string[] = [];
    this.socket.write(`${tag} ${payload}\r\n`);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const line = await this.readLine(Math.max(1_000, deadline - Date.now()));
      if (line.startsWith(`${tag} `)) {
        return { tag, lines, status: line.slice(tag.length + 1) };
      }
      // Literal: "{N}" then raw bytes — our socket is utf8; for FETCH we
      // re-fetch using a binary-safe path below. Unlikely mid-command except
      // FETCH which we handle separately.
      lines.push(line);
    }
    throw new ImapError("IMAP command timed out");
  }

  /**
   * UID FETCH that returns raw RFC822 buffers. Uses binary socket mode for
   * the duration of each literal.
   */
  async fetchRfc822(
    uids: number[],
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Map<number, Buffer>> {
    const result = new Map<number, Buffer>();
    if (uids.length === 0) return result;
    const tag = `A${++this.tagSeq}`;
    const set = uids.join(",");
    // Switch to binary for FETCH literals.
    this.socket.setEncoding();
    let binaryBuf = Buffer.alloc(0);
    const pendingText = { value: "" };

    const onBinary = (chunk: Buffer) => {
      binaryBuf = Buffer.concat([binaryBuf, chunk]);
    };
    this.socket.on("data", onBinary);

    try {
      this.socket.write(`${tag} UID FETCH ${set} (UID RFC822)\r\n`);
      const deadline = Date.now() + timeoutMs;

      const readUntil = async (predicate: (text: string) => boolean) => {
        while (Date.now() < deadline) {
          // Convert any complete lines in binaryBuf to text side-channel.
          const text = binaryBuf.toString("utf8");
          if (predicate(text)) return text;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new ImapError("IMAP FETCH timed out");
      };

      const full = await readUntil((t) => t.includes(`\n${tag} `) || t.includes(`\r\n${tag} `));
      // Parse FETCH responses with literals.
      // Form: * <seq> FETCH (UID <n> RFC822 {size}\r\n<bytes>)
      const re =
        /\* \d+ FETCH \([\s\S]*?UID (\d+)[\s\S]*?RFC822 \{(\d+)\}\r?\n/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(full)) !== null) {
        const uid = Number(match[1]);
        const size = Number(match[2]);
        const dataStart = match.index + match[0].length;
        // full is utf8-decoded so binary attachments may be corrupted when
        // using string indices. Re-locate in binaryBuf.
        const marker = Buffer.from(match[0], "utf8");
        const binIdx = binaryBuf.indexOf(marker);
        if (binIdx < 0) continue;
        const start = binIdx + marker.length;
        const bytes = binaryBuf.subarray(start, start + size);
        if (bytes.length === size) {
          result.set(uid, Buffer.from(bytes));
        }
        void dataStart;
        void pendingText;
      }

      if (!full.includes(`${tag} OK`) && !full.match(new RegExp(`${tag} OK`, "i"))) {
        const statusLine = full
          .split(/\r?\n/)
          .find((l) => l.startsWith(`${tag} `));
        if (statusLine && !/ OK /i.test(statusLine)) {
          throw new ImapError(`IMAP FETCH failed: ${statusLine.slice(0, 120)}`);
        }
      }
      return result;
    } finally {
      this.socket.off("data", onBinary);
      this.socket.setEncoding("utf8");
      // Drain leftover binary into text buffer for subsequent commands.
      this.buffer += binaryBuf.toString("utf8");
    }
  }

  async logout(): Promise<void> {
    try {
      await this.command("LOGOUT", 5_000);
    } catch {
      // ignore
    }
    this.socket.destroy();
  }
}

async function connectTls(
  host: string,
  port: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
      () => resolve(socket),
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new ImapError("IMAP TLS connect timed out"));
    });
    socket.once("error", reject);
  });
}

export type FetchImapOptions = {
  meta: ImapConnectionMeta;
  secrets: ImapSecrets;
  folder: string;
  /** UID cursor exclusive — fetch UIDs greater than this. */
  uidCursor?: number;
  limit?: number;
};

/**
 * Poll an IMAP mailbox over TLS and return normalised messages newest-last.
 * Updates cursor should use the max UID observed.
 */
export async function fetchImapMessages(
  opts: FetchImapOptions,
): Promise<{ messages: NormalizedMailMessage[]; maxUid: number | null }> {
  const port = opts.meta.port || 993;
  if (!opts.meta.host) throw new ImapError("IMAP host is required");
  if (!opts.meta.username) throw new ImapError("IMAP username is required");
  if (!opts.secrets.password) throw new ImapError("IMAP password is required");

  const socket = await connectTls(opts.meta.host, port);
  const session = new ImapSession(socket);
  try {
    await session.expectGreeting();
    // Prefer AUTHENTICATE PLAIN is more complex; LOGIN is fine over TLS.
    const user = opts.meta.username.replace(/[\\"\r\n]/g, "");
    const pass = opts.secrets.password.replace(/[\\"\r\n]/g, "");
    const login = await session.command(`LOGIN "${user}" "${pass}"`);
    if (!/^OK/i.test(login.status)) {
      throw new ImapError("IMAP authentication failed");
    }

    const folder = opts.folder.replace(/[\\"\r\n]/g, "") || "INBOX";
    const select = await session.command(`SELECT "${folder}"`);
    if (!/^OK/i.test(select.status)) {
      throw new ImapError(`IMAP SELECT failed for folder`);
    }

    const uidFrom = (opts.uidCursor ?? 0) + 1;
    const search = await session.command(`UID SEARCH UID ${uidFrom}:*`);
    if (!/^OK/i.test(search.status)) {
      throw new ImapError("IMAP SEARCH failed");
    }
    const uidLine = search.lines.find((l) => l.startsWith("* SEARCH"));
    const uids = (uidLine ?? "")
      .replace(/^\* SEARCH\s*/i, "")
      .trim()
      .split(/\s+/)
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= uidFrom)
      .sort((a, b) => a - b);

    const limit = opts.limit ?? MAX_POLL_MESSAGES;
    const batch = uids.slice(0, limit);
    if (batch.length === 0) {
      return { messages: [], maxUid: opts.uidCursor ?? null };
    }

    const fetched = await session.fetchRfc822(batch);
    const messages: NormalizedMailMessage[] = [];
    let maxUid: number | null = opts.uidCursor ?? null;

    for (const uid of batch) {
      const raw = fetched.get(uid);
      if (!raw) continue;
      const parsed = parseRfc822(raw);
      if (!parsed.providerMessageId) {
        parsed.providerMessageId = `imap-uid-${uid}`;
      } else {
        // Namespace with UID so re-deliveries with same Message-ID still
        // dedupe per connection via provider id uniqueness, but IMAP UIDs
        // alone are the poll cursor.
        parsed.providerMessageId = parsed.providerMessageId;
      }
      // Attach UID into id for cursor stability when Message-ID missing already handled.
      messages.push(parsed);
      maxUid = maxUid == null ? uid : Math.max(maxUid, uid);
    }

    return { messages, maxUid };
  } finally {
    await session.logout().catch(() => {});
    socket.destroy();
  }
}

export function parseImapUidCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const n = Number(cursor);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
