import AccountSecurity from "@/components/account-security";
import { requireUser } from "@/lib/session";

export default async function AccountSecurityPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-2xl">
      <AccountSecurity
        twoFactorEnabled={user.twoFactorEnabled}
        mfaRequired={user.mfaRequired}
      />
    </div>
  );
}
