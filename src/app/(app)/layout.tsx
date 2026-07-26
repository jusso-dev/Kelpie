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
      <div className="lg:pl-60">
        <main className="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {accountAction ?? children}
        </main>
      </div>
    </div>
  );
}
