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
    <div className="space-y-4">
      {isAdmin ? (
        <form action={inviteUser} className="rounded border border-[color:var(--color-navy-700)] p-3">
          <h3 className="mb-3 text-sm font-medium text-slate-300">Invite user</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Name" name="name" />
            <Field label="Email" name="email" type="email" />
            <div>
              <label
                htmlFor="invite-role"
                className="mb-1 block text-xs uppercase tracking-wider text-slate-400"
              >
                Role
              </label>
              <select id="invite-role" name="role" className="kelpie-input" defaultValue="analyst">
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button className="kelpie-btn kelpie-btn-primary w-full">
                Invite
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Invites create a temporary password and email it when email is configured.
          </p>
        </form>
      ) : (
        <p className="text-xs text-slate-500">Only administrators can manage team members.</p>
      )}

      <div className="kelpie-scroll-x" tabIndex={0} aria-label="Team members table">
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>MFA</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium text-slate-100">{u.name}</div>
                    {u.invitedAt ? (
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        invited
                      </div>
                    ) : null}
                  </td>
                  <td className="text-slate-400">{u.email}</td>
                  <td>
                    {isAdmin ? (
                      <form action={setUserRole} className="flex min-w-36 gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <select
                          name="role"
                          className="kelpie-input"
                          defaultValue={u.role}
                          aria-label={`Role for ${u.name}`}
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
                      <span className="text-slate-300">{roleLabel(u.role)}</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {u.banned ? (
                      <span className="text-red-400">
                        locked{u.banReason ? `: ${u.banReason}` : ""}
                      </span>
                    ) : u.passwordResetRequired ? (
                      <span className="text-amber-400">password reset issued</span>
                    ) : (
                      <span className="text-green-400">active</span>
                    )}
                  </td>
                  <td className="text-xs">
                    <div className="space-y-1">
                      <div className={u.twoFactorEnabled ? "text-green-400" : "text-slate-500"}>
                        {u.twoFactorEnabled ? "enabled" : "not enrolled"}
                      </div>
                      {u.mfaRequired ? (
                        <div className="text-[color:var(--color-tan-300)]">required</div>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {isAdmin ? (
                      <div className="flex min-w-72 flex-wrap justify-end gap-2">
                        <form action={resetUserPassword}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button className="kelpie-btn kelpie-btn-secondary">
                            Reset password
                          </button>
                        </form>
                        {u.banned ? (
                          <form action={unlockUser}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button className="kelpie-btn kelpie-btn-secondary">
                              Unlock
                            </button>
                          </form>
                        ) : (
                          <form action={lockUser}>
                            <input type="hidden" name="userId" value={u.id} />
                            <input
                              type="hidden"
                              name="reason"
                              value="Locked by organisation administrator"
                            />
                            <button
                              className="kelpie-btn kelpie-btn-ghost text-red-400"
                              disabled={isSelf}
                            >
                              Lock
                            </button>
                          </form>
                        )}
                        <form action={setMfaRequired}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input
                            type="hidden"
                            name="required"
                            value={u.mfaRequired ? "false" : "true"}
                          />
                          <button className="kelpie-btn kelpie-btn-secondary">
                            {u.mfaRequired ? "MFA optional" : "Require MFA"}
                          </button>
                        </form>
                        <form action={resetUserMfa}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button className="kelpie-btn kelpie-btn-secondary">
                            Reset MFA
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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
