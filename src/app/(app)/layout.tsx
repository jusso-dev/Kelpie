import Nav from "@/components/nav";
import AccountSecurity from "@/components/account-security";
import PasswordChangeRequired from "@/components/password-change-required";
import { requireUser } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const accountAction = user.passwordResetRequired ? (
    <PasswordChangeRequired />
  ) : user.mfaRequired && !user.twoFactorEnabled ? (
    <div className="mx-auto max-w-2xl">
      <AccountSecurity
        twoFactorEnabled={user.twoFactorEnabled}
        mfaRequired={user.mfaRequired}
      />
    </div>
  ) : null;

  return (
    <div className="min-h-screen">
      <Nav organisationName={user.organisationName} userName={user.name} />
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
        <div className="rounded-xl bg-[color:var(--color-navy-950)] p-3 shadow-2xl shadow-slate-950/20 sm:p-5">
          {accountAction ?? children}
        </div>
      </main>
    </div>
  );
}
