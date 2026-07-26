import {
  inviteUser,
  lockUser,
  resetUserMfa,
  resetUserPassword,
  setMfaRequired,
  setUserRole,
  unlockUser,
} from "@/actions/users";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "analyst" | "read_only";
  banned: boolean;
  banReason: string | null;
  passwordResetRequired: boolean;
  mfaRequired: boolean;
  twoFactorEnabled: boolean;
  invitedAt: string | null;
  lastPasswordResetAt: string | null;
};

const ROLES = ["admin", "analyst", "read_only"] as const;

function roleLabel(role: (typeof ROLES)[number]) {
  if (role === "admin") return "administrator";
  if (role === "read_only") return "read only";
  return role;
}

export default function TeamManagement({
  members,
  isAdmin,
  currentUserId,
}: {
  members: TeamMember[];
  isAdmin: boolean;
  currentUserId: string;
}) {
  return (
    <div className="space-y-5">
      {isAdmin ? (
        <form
          action={inviteUser}
          className="rounded-lg border border-[color:var(--color-navy-700)] p-4 md:p-5"
        >
          <div className="mb-4">
            <h3 className="text-sm font-medium text-slate-200">Invite user</h3>
            <p className="mt-1 text-xs text-slate-500">
              A temporary password is emailed when an email provider is configured.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(10rem,1fr)_minmax(14rem,1.4fr)_minmax(10rem,.75fr)_auto] lg:items-end">
            <Field label="Name" name="name" />
            <Field label="Email" name="email" type="email" />
            <div>
              <label
                htmlFor="invite-role"
                className="mb-1 block text-xs uppercase tracking-wider text-slate-400"
              >
                Role
              </label>
              <select
                id="invite-role"
                name="role"
                className="kelpie-input"
                defaultValue="analyst"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </div>
            <button className="kelpie-btn kelpie-btn-primary justify-center px-8">
              Invite
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-slate-500">
          Only administrators can manage team members.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-[color:var(--color-navy-700)]">
        <div className="hidden grid-cols-[minmax(10rem,1fr)_minmax(13rem,1.35fr)_minmax(14rem,1.15fr)_minmax(9rem,.7fr)_auto] gap-4 border-b border-[color:var(--color-navy-700)] px-4 py-3 text-[10px] uppercase tracking-wider text-slate-500 lg:grid">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Access</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="divide-y divide-[color:var(--color-navy-700)]">
          {members.map((member) => {
            const isSelf = member.id === currentUserId;
            return (
              <article
                key={member.id}
                className="grid gap-4 p-4 lg:grid-cols-[minmax(10rem,1fr)_minmax(13rem,1.35fr)_minmax(14rem,1.15fr)_minmax(9rem,.7fr)_auto] lg:items-center"
              >
                <div>
                  <div className="font-medium text-slate-100">{member.name}</div>
                  {member.invitedAt ? (
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                      invited
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 lg:hidden">
                    Email
                  </p>
                  <p className="truncate text-sm text-slate-400">{member.email}</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500 lg:hidden">
                    Role
                  </p>
                  {isAdmin ? (
                    <form action={setUserRole} className="flex gap-2">
                      <input type="hidden" name="userId" value={member.id} />
                      <select
                        name="role"
                        className="kelpie-input"
                        defaultValue={member.role}
                        aria-label={`Role for ${member.name}`}
                        disabled={isSelf}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </select>
                      <button
                        className="kelpie-btn kelpie-btn-secondary"
                        disabled={isSelf}
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <span className="text-sm text-slate-300">
                      {roleLabel(member.role)}
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-xs">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 lg:hidden">
                    Access
                  </p>
                  {member.banned ? (
                    <p className="text-red-400">
                      locked{member.banReason ? `: ${member.banReason}` : ""}
                    </p>
                  ) : member.passwordResetRequired ? (
                    <p className="text-amber-400">password reset issued</p>
                  ) : (
                    <p className="text-green-400">active</p>
                  )}
                  <p
                    className={
                      member.twoFactorEnabled
                        ? "text-green-400"
                        : "text-slate-500"
                    }
                  >
                    MFA {member.twoFactorEnabled ? "enabled" : "not enrolled"}
                    {member.mfaRequired ? " · required" : ""}
                  </p>
                </div>
                {isAdmin ? (
                  <details className="relative justify-self-start lg:justify-self-end">
                    <summary className="kelpie-btn kelpie-btn-secondary cursor-pointer list-none text-xs">
                      Manage
                    </summary>
                    <div className="z-20 mt-2 grid min-w-52 gap-1 rounded border border-[color:var(--color-navy-600)] bg-[color:var(--color-navy-800)] p-2 shadow-xl lg:absolute lg:right-0">
                      <ActionForm action={resetUserPassword} userId={member.id}>
                        Reset password
                      </ActionForm>
                      {member.banned ? (
                        <ActionForm action={unlockUser} userId={member.id}>
                          Unlock
                        </ActionForm>
                      ) : (
                        <form action={lockUser}>
                          <input type="hidden" name="userId" value={member.id} />
                          <input
                            type="hidden"
                            name="reason"
                            value="Locked by organisation administrator"
                          />
                          <button
                            className="kelpie-btn kelpie-btn-ghost w-full justify-start text-xs text-red-400"
                            disabled={isSelf}
                          >
                            Lock account
                          </button>
                        </form>
                      )}
                      <form action={setMfaRequired}>
                        <input type="hidden" name="userId" value={member.id} />
                        <input
                          type="hidden"
                          name="required"
                          value={member.mfaRequired ? "false" : "true"}
                        />
                        <button className="kelpie-btn kelpie-btn-ghost w-full justify-start text-xs">
                          {member.mfaRequired ? "Make MFA optional" : "Require MFA"}
                        </button>
                      </form>
                      <ActionForm action={resetUserMfa} userId={member.id}>
                        Reset MFA
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ActionForm({
  action,
  userId,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  userId: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button className="kelpie-btn kelpie-btn-ghost w-full justify-start text-xs">
        {children}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
}: {
  label: string;
  name: string;
  type?: string;
}) {
  return (
    <div>
      <label
        htmlFor={`invite-${name}`}
        className="mb-1 block text-xs uppercase tracking-wider text-slate-400"
      >
        {label}
      </label>
      <input
        id={`invite-${name}`}
        name={name}
        type={type}
        className="kelpie-input"
        required
      />
    </div>
  );
}
