"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearOidcConfig,
  clearSamlConfig,
  saveOidcConfig,
  saveSamlConfig,
  setForceSso,
} from "@/actions/sso";

type Props = {
  isAdmin: boolean;
  forceSso: boolean;
  slug: string;
  baseUrl: string;
  oidc: {
    issuer?: string;
    clientId?: string;
    scopes?: string;
    roleClaim?: string;
    roleMap?: Record<string, string>;
  } | null;
  saml: {
    idpEntityId?: string;
    idpSsoUrl?: string;
    nameAttribute?: string;
    roleAttribute?: string;
    roleMap?: Record<string, string>;
  } | null;
};

function roleMapToText(m: Record<string, string> | undefined): string {
  if (!m) return "";
  return Object.entries(m)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="block break-all rounded bg-[color:var(--color-navy-800)] px-2 py-1 text-xs text-[color:var(--color-tan-300)]">
      {children}
    </code>
  );
}

export default function SsoSettings({
  isAdmin,
  forceSso,
  slug,
  baseUrl,
  oidc,
  saml,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function submit(action: (fd: FormData) => Promise<void>, e: React.FormEvent<HTMLFormElement>, key: string) {
    e.preventDefault();
    setPending(key);
    try {
      await action(new FormData(e.currentTarget));
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="kelpie-card p-5 space-y-2">
        <h2 className="text-sm font-medium text-slate-300">Force SSO</h2>
        <p className="text-xs text-slate-500">
          When on, email and password sign in is rejected for this organisation.
          Make sure an SSO provider works before enabling.
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            className="kelpie-checkbox"
            defaultChecked={forceSso}
            disabled={!isAdmin}
            onChange={async (e) => {
              await setForceSso(e.target.checked);
              router.refresh();
            }}
          />
          Require single sign-on for all members
        </label>
      </section>

      <section className="kelpie-card p-5 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">
          OpenID Connect (Entra, Okta, Google)
        </h2>
        <p className="text-xs text-slate-500">
          Sign-in URL for your IdP bookmark / portal:
        </p>
        <Mono>{`${baseUrl}/api/sso/oidc/${slug}/start`}</Mono>
        <p className="text-xs text-slate-500">Redirect / callback URL:</p>
        <Mono>{`${baseUrl}/api/sso/oidc/${slug}/callback`}</Mono>
        <form
          onSubmit={(e) => submit(saveOidcConfig, e, "oidc")}
          className="space-y-2"
        >
          <Field name="issuer" label="Issuer URL" defaultValue={oidc?.issuer} required placeholder="https://login.microsoftonline.com/<tenant>/v2.0" />
          <Field name="clientId" label="Client ID" defaultValue={oidc?.clientId} required />
          <Field name="clientSecret" label="Client secret" type="password" required={!oidc} placeholder={oidc ? "unchanged — re-enter to update" : ""} />
          <Field name="scopes" label="Scopes" defaultValue={oidc?.scopes} placeholder="openid email profile" />
          <Field name="roleClaim" label="Role claim (optional)" defaultValue={oidc?.roleClaim} placeholder="roles" />
          <TextField name="roleMap" label="Role map (claim=role per line)" defaultValue={roleMapToText(oidc?.roleMap)} placeholder={"SOC-Admins=admin\nSOC-Analysts=analyst"} />
          {isAdmin ? (
            <div className="flex justify-end gap-2">
              {oidc ? (
                <button
                  type="button"
                  className="kelpie-btn kelpie-btn-ghost text-red-400"
                  onClick={async () => {
                    if (!confirm("Remove OIDC configuration?")) return;
                    await clearOidcConfig();
                    router.refresh();
                  }}
                >
                  Remove
                </button>
              ) : null}
              <button className="kelpie-btn kelpie-btn-primary" disabled={pending === "oidc"}>
                {pending === "oidc" ? "Saving..." : "Save OIDC"}
              </button>
            </div>
          ) : null}
        </form>
      </section>

      <section className="kelpie-card p-5 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">SAML 2.0</h2>
        <p className="text-xs text-slate-500">Sign-in URL:</p>
        <Mono>{`${baseUrl}/api/sso/saml/${slug}/start`}</Mono>
        <p className="text-xs text-slate-500">ACS (reply) URL:</p>
        <Mono>{`${baseUrl}/api/sso/saml/${slug}/acs`}</Mono>
        <p className="text-xs text-slate-500">SP entity id / metadata:</p>
        <Mono>{`${baseUrl}/api/sso/saml/${slug}/metadata`}</Mono>
        <form
          onSubmit={(e) => submit(saveSamlConfig, e, "saml")}
          className="space-y-2"
        >
          <Field name="idpEntityId" label="IdP entity ID" defaultValue={saml?.idpEntityId} />
          <Field name="idpSsoUrl" label="IdP SSO URL" defaultValue={saml?.idpSsoUrl} required />
          <TextField name="idpCertificate" label="IdP signing certificate (PEM or base64)" required={!saml} placeholder={saml ? "unchanged — paste to update" : "-----BEGIN CERTIFICATE-----"} />
          <Field name="nameAttribute" label="Name attribute (optional)" defaultValue={saml?.nameAttribute} />
          <Field name="roleAttribute" label="Role attribute (optional)" defaultValue={saml?.roleAttribute} />
          <TextField name="roleMap" label="Role map (claim=role per line)" defaultValue={roleMapToText(saml?.roleMap)} />
          {isAdmin ? (
            <div className="flex justify-end gap-2">
              {saml ? (
                <button
                  type="button"
                  className="kelpie-btn kelpie-btn-ghost text-red-400"
                  onClick={async () => {
                    if (!confirm("Remove SAML configuration?")) return;
                    await clearSamlConfig();
                    router.refresh();
                  }}
                >
                  Remove
                </button>
              ) : null}
              <button className="kelpie-btn kelpie-btn-primary" disabled={pending === "saml"}>
                {pending === "saml" ? "Saving..." : "Save SAML"}
              </button>
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  defaultValue,
  required,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
        {label}
        {required ? " *" : ""}
      </label>
      <input
        name={name}
        type={type}
        className="kelpie-input"
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
      />
    </div>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  required,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
        {label}
        {required ? " *" : ""}
      </label>
      <textarea
        name={name}
        className="kelpie-input"
        rows={3}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
      />
    </div>
  );
}
