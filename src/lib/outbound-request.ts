import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";

const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

type OutboundBody = string | URLSearchParams | Uint8Array;

export type SafeRequestInit = Omit<RequestInit, "body" | "redirect"> & {
  body?: OutboundBody;
  maxResponseBytes?: number;
};

type LookupAll = (hostname: string) => Promise<LookupAddress[]>;

function privateNetworksAllowed(): boolean {
  return process.env.KELPIE_ALLOW_PRIVATE_NETWORKS === "true";
}

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}

function parseOutboundUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input) : new URL(input);
  } catch {
    throw new Error("Outbound URL is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Outbound URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Outbound URL must not contain credentials");
  }
  if (!url.hostname) throw new Error("Outbound URL must include a hostname");
  return url;
}

async function systemLookup(hostname: string): Promise<LookupAddress[]> {
  return dnsLookup(hostname, { all: true, order: "verbatim" });
}

export async function resolveOutboundTarget(
  input: string | URL,
  lookupAll: LookupAll = systemLookup,
): Promise<{ url: URL; addresses: LookupAddress[] }> {
  const url = parseOutboundUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literal = ipaddr.isValid(hostname);
  const addresses = literal
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 : 6 }]
    : await lookupAll(hostname);

  if (addresses.length === 0) {
    throw new Error(`Outbound hostname did not resolve: ${url.hostname}`);
  }
  if (
    !privateNetworksAllowed() &&
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error(`Outbound URL resolves to a non-public address: ${url.hostname}`);
  }
  return { url, addresses };
}

export async function assertSafeOutboundUrl(input: string | URL): Promise<void> {
  await resolveOutboundTarget(input);
}

/**
 * HTTP(S) request with DNS results pinned to the addresses that passed policy.
 * Node's request client does not follow redirects, so a 3xx destination must
 * be checked explicitly by the caller before any subsequent request.
 */
export async function safeFetch(
  input: string | URL,
  init: SafeRequestInit = {},
): Promise<Response> {
  const { url, addresses } = await resolveOutboundTarget(input);
  const transport = url.protocol === "https:" ? https : http;
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = init.body instanceof URLSearchParams ? init.body.toString() : init.body;
  const maxResponseBytes = init.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: init.method,
        headers,
        signal: init.signal ?? undefined,
        lookup: ((
          _hostname: string,
          options: { family?: number; all?: boolean },
          callback: (
            error: NodeJS.ErrnoException | null,
            address: string | LookupAddress[],
            family?: number,
          ) => void,
        ) => {
          const matching = options.family
            ? addresses.filter((item) => item.family === options.family)
            : addresses;
          if (matching.length === 0) {
            const error = new Error("No approved address matches the requested family") as NodeJS.ErrnoException;
            error.code = "ENOTFOUND";
            callback(error, "");
            return;
          }
          if (options.all) {
            callback(null, matching);
          } else {
            callback(null, matching[0].address, matching[0].family);
          }
        }) as never,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxResponseBytes) {
            request.destroy(new Error("Outbound response exceeded the size limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(name, item);
            } else if (value !== undefined) {
              responseHeaders.set(name, value);
            }
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}
