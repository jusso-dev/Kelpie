import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSsoSettings, appBaseUrl } from "@/lib/sso/config";
import SsoSettings from "@/components/sso-settings";

export default async function SsoSettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const sso = await getSsoSettings(user.organisationId);

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Single sign-on</h1>
        <p className="text-sm text-slate-400">
          Configure SAML or OIDC for {user.organisationName}. First sign in
          provisions the user; the role comes from your mapping.
        </p>
      </header>

      {!isAdmin ? (
        <p className="text-sm text-slate-500">
          Only administrators can change SSO settings.
        </p>
      ) : null}

      <SsoSettings
        isAdmin={isAdmin}
        forceSso={Boolean(sso.forceSso)}
        slug={user.organisationSlug}
        baseUrl={appBaseUrl()}
        oidc={
          sso.oidc
            ? {
                issuer: sso.oidc.issuer,
                clientId: sso.oidc.clientId,
                scopes: sso.oidc.scopes,
                roleClaim: sso.oidc.roleClaim,
                roleMap: sso.oidc.roleMap,
              }
            : null
        }
        saml={
          sso.saml
            ? {
                idpEntityId: sso.saml.idpEntityId,
                idpSsoUrl: sso.saml.idpSsoUrl,
                nameAttribute: sso.saml.nameAttribute,
                roleAttribute: sso.saml.roleAttribute,
                roleMap: sso.saml.roleMap,
              }
            : null
        }
      />
    </div>
  );
}
