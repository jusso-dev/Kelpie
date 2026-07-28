"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Plug } from "lucide-react";
import { toast } from "sonner";
import { createApiToken } from "@/actions/settings";
import {
  MCP_PROTOCOL_VERSION,
  formatToolScopeLines,
  mcpDefaultScopes,
  toolsPermittedByScopes,
} from "@/lib/mcp/catalogue";
import {
  MCP_TOKEN_PLACEHOLDER,
  buildAgentsMdBlock,
  buildConnectionDetails,
  buildCursorMcpConfig,
  buildLlmTxtPrompt,
  buildVsCodeMcpConfig,
  describePublicUrlError,
  mcpScopeCapabilities,
  toolsExpectedForScopes,
  type PublicUrlResolution,
} from "@/lib/mcp/onboarding";
import type { ScopeValue } from "@/lib/scopes";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

async function copyText(text: string, label: string, sensitive = false) {
  try {
    await navigator.clipboard.writeText(text);
    if (sensitive) {
      toast.success(`${label} copied`, {
        description:
          "Clipboard contains a live secret. Paste into a private client config only — never commit it.",
      });
    } else {
      toast.success(`${label} copied`);
    }
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`, {
      description: "Copy it manually instead.",
    });
  }
}

function CopyBlock({
  label,
  text,
  sensitive = false,
  description,
}: {
  label: string;
  text: string;
  sensitive?: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs uppercase tracking-wider text-slate-400">
            {label}
          </h4>
          {description ? (
            <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="kelpie-btn kelpie-btn-secondary text-xs"
          onClick={() => void copyText(text, label, sensitive)}
          aria-label={`Copy ${label}`}
        >
          <Copy size={14} aria-hidden="true" />
          Copy {label}
        </button>
      </div>
      <pre
        className="kelpie-scroll-x max-h-56 overflow-y-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs text-slate-300 whitespace-pre-wrap"
        tabIndex={0}
        aria-label={label}
      >
        {text}
      </pre>
    </div>
  );
}

export default function McpOnboarding({
  publicUrl,
  organisationName,
  isAdmin,
}: {
  publicUrl: PublicUrlResolution;
  organisationName: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const capabilities = useMemo(() => mcpScopeCapabilities(), []);
  const defaultScopes = useMemo(() => mcpDefaultScopes(), []);

  const [scopes, setScopes] = useState<string[]>(() => [...defaultScopes]);
  const [expiresAt, setExpiresAt] = useState("90");
  const [name, setName] = useState("mcp-agent");
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [placeholderMode, setPlaceholderMode] = useState(true);
  const [verifyState, setVerifyState] = useState<
    | { status: "idle" }
    | { status: "pending" }
    | { status: "ok"; tools: string[] }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const endpoint = publicUrl.ok ? publicUrl.endpoint : "";
  const copyInput = {
    endpoint: endpoint || "https://your-kelpie.example/api/mcp",
    scopes,
    token: issued,
    placeholderMode: placeholderMode || !issued,
    organisationName,
  };

  const connectionDetails = buildConnectionDetails(copyInput);
  const cursorConfig = buildCursorMcpConfig(copyInput);
  const vsCodeConfig = buildVsCodeMcpConfig(copyInput);
  const agentsBlock = buildAgentsMdBlock(copyInput);
  const llmTxt = buildLlmTxtPrompt();
  const permittedTools = toolsPermittedByScopes(scopes);
  const sensitive = Boolean(issued && !placeholderMode);

  function toggleScope(scope: string) {
    // Changing scopes after issue would make copy/verify claim tools the
    // frozen token does not have — clear the one-time secret so configs
    // cannot drift from the minted scopes without an explicit re-create.
    setIssued(null);
    setVerifyState({ status: "idle" });
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function onCreateToken(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setPending(true);
    setVerifyState({ status: "idle" });
    try {
      const fd = new FormData();
      fd.set("name", name.trim() || "mcp-agent");
      fd.set("scopes", JSON.stringify(scopes));
      fd.set("expiresAt", expiresAt);
      const res = await createApiToken(fd);
      setIssued(res.plaintext);
      setPlaceholderMode(true);
      toast.success("MCP token created", {
        description: "Copy it now — Kelpie will never show this secret again.",
      });
      router.refresh();
    } catch (error) {
      toast.error("Token could not be created", {
        description:
          error instanceof Error ? error.message : "Try again or check permissions.",
      });
    } finally {
      setPending(false);
    }
  }

  async function verifyConnection() {
    if (!publicUrl.ok) {
      setVerifyState({
        status: "error",
        message: describePublicUrlError(publicUrl.reason),
      });
      return;
    }
    if (!issued) {
      setVerifyState({
        status: "error",
        message:
          "Create an MCP token first. Verification uses the one-time secret held only in this browser session and never logs it.",
      });
      return;
    }
    setVerifyState({ status: "pending" });
    try {
      const res = await fetch(publicUrl.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${issued}`,
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });
      const json = (await res.json()) as {
        error?: { message?: string; code?: number };
        result?: { tools?: Array<{ name: string }> };
      };
      if (!res.ok || json.error) {
        const msg = json.error?.message ?? `HTTP ${res.status}`;
        if (/expired|deprecated|invalid|Authentication failed/i.test(msg)) {
          setVerifyState({
            status: "error",
            message: `Token rejected: ${msg}. Create a new token or check that it was not revoked.`,
          });
          return;
        }
        if (/Missing scope|forbidden|scope/i.test(msg)) {
          setVerifyState({
            status: "error",
            message: `Insufficient scope: ${msg}. Add the missing scope and reissue the token.`,
          });
          return;
        }
        setVerifyState({ status: "error", message: msg });
        return;
      }
      const names = (json.result?.tools ?? []).map((t) => t.name).sort();
      const expected = toolsExpectedForScopes(scopes).sort();
      const unexpected = names.filter((n) => !expected.includes(n));
      const missing = expected.filter((n) => !names.includes(n));
      if (unexpected.length || missing.length) {
        setVerifyState({
          status: "error",
          message: `Endpoint reachable, but tool set differs from selected scopes. Missing: ${
            missing.join(", ") || "none"
          }. Extra: ${unexpected.join(", ") || "none"}.`,
        });
        return;
      }
      setVerifyState({ status: "ok", tools: names });
    } catch {
      setVerifyState({
        status: "error",
        message:
          "Could not reach the MCP endpoint. Check APP_URL, network access, and that this browser can call the public origin.",
      });
    }
  }

  if (!isAdmin) {
    return (
      <p className="text-xs text-slate-500">
        Only administrators can configure MCP agent onboarding and issue tokens.
        Ask an admin under Settings → MCP agent setup.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm leading-6 text-slate-400">
        Kelpie exposes a stateless Streamable HTTP MCP endpoint for agents.
        Most tools are read-only (threat intelligence, landscape, cyber brief,
        relationships, evidence metadata, playbooks, ATT&amp;CK coverage). The
        only write tool is{" "}
        <code className="text-slate-300">attack_technique_attach</code>, which
        needs <code className="text-slate-300">attack:write</code>. Defaults
        below use least-privilege read scopes with an explicit expiry.
      </p>

      {!publicUrl.ok ? (
        <div
          className="flex gap-2 rounded border border-amber-700/60 bg-amber-950/20 p-3 text-sm text-amber-100"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Public URL not ready</p>
            <p className="mt-1 text-xs text-amber-200/90">
              {describePublicUrlError(publicUrl.reason)}
            </p>
          </div>
        </div>
      ) : (
        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-slate-400">
            MCP endpoint
          </h4>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded bg-[color:var(--color-navy-800)] px-3 py-2 text-xs text-slate-200">
              POST {publicUrl.endpoint}
            </code>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary text-xs"
              onClick={() => void copyText(publicUrl.endpoint, "Endpoint")}
              aria-label="Copy MCP endpoint"
            >
              <Copy size={14} aria-hidden="true" />
              Copy endpoint
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Derived from the configured public application URL (APP_URL), not
            the request Host header.
          </p>
        </div>
      )}

      <form onSubmit={onCreateToken} className="space-y-3 rounded border border-[color:var(--color-navy-700)] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <label
              htmlFor="mcp-token-name"
              className="mb-1 block text-xs uppercase tracking-wider text-slate-400"
            >
              Token name
            </label>
            <input
              id="mcp-token-name"
              className="kelpie-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mcp-agent"
              required
            />
          </div>
          <div className="min-w-[10rem]">
            <label
              htmlFor="mcp-token-expiry"
              className="mb-1 block text-xs uppercase tracking-wider text-slate-400"
            >
              Expiry
            </label>
            <select
              id="mcp-token-expiry"
              className="kelpie-input"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs uppercase tracking-wider text-slate-400">
            Capabilities (scopes)
          </legend>
          <p className="mb-2 text-xs text-slate-500">
            Defaults are read-only scopes required by the current MCP tool
            catalogue. Uncheck anything this agent should not see.
          </p>
          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            {capabilities.map((cap) => (
              <label
                key={cap.scope}
                className="flex cursor-pointer items-start gap-2 rounded border border-transparent p-1 hover:border-[color:var(--color-navy-700)]"
              >
                <input
                  type="checkbox"
                  className="kelpie-checkbox mt-0.5"
                  checked={scopes.includes(cap.scope)}
                  onChange={() => toggleScope(cap.scope)}
                />
                <span>
                  <span className="font-mono text-slate-300">{cap.scope}</span>
                  {!cap.readOnly ? (
                    <span className="ml-2 text-[10px] uppercase text-amber-400">
                      write
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-slate-500">{cap.label}</span>
                  <span className="mt-0.5 block font-mono text-[10px] text-slate-600">
                    {cap.tools.join(", ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="kelpie-btn kelpie-btn-ghost text-xs"
            onClick={() => setScopes([...defaultScopes])}
          >
            Reset to read-only defaults
          </button>
          <button
            type="submit"
            className="kelpie-btn kelpie-btn-primary"
            disabled={pending || scopes.length === 0 || !publicUrl.ok}
          >
            {pending ? "Creating…" : "Create MCP token"}
          </button>
        </div>
      </form>

      {issued ? (
        <div
          className="rounded border border-[color:var(--color-tan-500)] bg-[color:var(--color-navy-800)] p-3 text-sm"
          role="status"
        >
          <p className="mb-1 text-slate-200">
            New MCP token. Copy it now — it will not be shown again and cannot
            be recovered.
          </p>
          <code className="break-all font-mono text-[color:var(--color-tan-300)]">
            {issued}
          </code>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary text-xs"
              onClick={() => void copyText(issued, "MCP token", true)}
            >
              <Copy size={14} aria-hidden="true" />
              Copy token
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="kelpie-checkbox"
            checked={placeholderMode || !issued}
            disabled={!issued}
            onChange={(e) => setPlaceholderMode(e.target.checked)}
          />
          <span className="text-slate-300">
            Placeholder mode (
            <code className="text-slate-400">{MCP_TOKEN_PLACEHOLDER}</code>)
          </span>
        </label>
        {issued && !placeholderMode ? (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <AlertTriangle size={14} aria-hidden />
            Copied configs will include the live token
          </span>
        ) : null}
      </div>

      <div className="space-y-4">
        <CopyBlock
          label="Connection details"
          text={connectionDetails}
          sensitive={sensitive}
          description="Generic Streamable HTTP connection block."
        />
        <CopyBlock
          label="Cursor / Claude-style config"
          text={cursorConfig}
          sensitive={sensitive}
          description="mcpServers JSON for clients that accept a URL + headers entry."
        />
        <CopyBlock
          label="VS Code MCP config"
          text={vsCodeConfig}
          sensitive={sensitive}
          description="servers JSON with type http for VS Code MCP."
        />
        <CopyBlock
          label="AGENTS.md block"
          text={agentsBlock}
          sensitive={sensitive}
          description="Ready-to-paste agent instructions with tool-to-scope mappings from the live catalogue."
        />
        <CopyBlock
          label="LLM.txt prompt"
          text={llmTxt}
          description="Canonical playbook agent prompt (placeholders only — never contains a secret)."
        />
      </div>

      <div>
        <h4 className="mb-1 text-xs uppercase tracking-wider text-slate-400">
          Tools for selected scopes
        </h4>
        <pre className="rounded bg-[color:var(--color-navy-800)] p-3 text-xs text-slate-300 whitespace-pre-wrap">
          {permittedTools.length > 0
            ? formatToolScopeLines(permittedTools)
            : "No tools match the selected scopes."}
        </pre>
      </div>

      <div className="space-y-2 rounded border border-[color:var(--color-navy-700)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs uppercase tracking-wider text-slate-400">
              Verify connection
            </h4>
            <p className="mt-0.5 text-xs text-slate-500">
              Calls <code className="text-slate-400">tools/list</code> on the
              public endpoint with the one-time token held in this session. The
              secret is never written to logs.
            </p>
          </div>
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary text-xs"
            onClick={() => void verifyConnection()}
            disabled={verifyState.status === "pending"}
          >
            <Plug size={14} aria-hidden="true" />
            {verifyState.status === "pending" ? "Verifying…" : "Verify tools/list"}
          </button>
        </div>
        {verifyState.status === "ok" ? (
          <div className="flex gap-2 text-xs text-green-300" role="status">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p>Endpoint reachable. Scope-permitted tools:</p>
              <p className="mt-1 font-mono text-green-200/90">
                {verifyState.tools.join(", ") || "(none)"}
              </p>
            </div>
          </div>
        ) : null}
        {verifyState.status === "error" ? (
          <div className="flex gap-2 text-xs text-red-300" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{verifyState.message}</p>
          </div>
        ) : null}
      </div>

      <div className="text-xs leading-5 text-slate-500">
        <p>
          <strong className="text-slate-400">Rotate / revoke:</strong> use the
          API tokens table below. Rotation shows a new secret once; revocation
          immediately cuts agent access. Remove the client config entry after
          revoke.
        </p>
        <p className="mt-1">
          <strong className="text-slate-400">Missing scope:</strong>{" "}
          <code className="text-slate-400">tools/list</code> omits the tool;
          <code className="text-slate-400"> tools/call</code> returns{" "}
          <code className="text-slate-400">Missing scope: …</code>. Reissue with
          the needed scope rather than widening unrelated access.
        </p>
        <p className="mt-1">
          Supported client shapes above cover Cursor/Claude-style{" "}
          <code className="text-slate-400">mcpServers</code> URL+headers and VS
          Code <code className="text-slate-400">type: &quot;http&quot;</code>.
          Other Streamable HTTP clients should use the generic connection
          details. Unsupported local stdio wrappers are out of scope for this
          endpoint.
        </p>
      </div>
    </div>
  );
}

/** Exported for tests that need the default scope list without React. */
export const MCP_ONBOARDING_DEFAULT_SCOPES: ScopeValue[] = mcpDefaultScopes();
