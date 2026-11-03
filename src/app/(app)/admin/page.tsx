import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { DATASETS } from "@/lib/datasets";
import { revokeApiKey, saveHubAliases, toggleLicensee, toggleUser } from "./actions";
import { ApiKeyForm, LicenseeForm, NewUserForm, ResetPasswordForm } from "./Forms";

const ROLE_LABEL = { admin: "Administrator", reviewer: "Reviewer", licensee: "Licensee officer" } as const;

export default async function AdminPage() {
  const me = await requireAdmin();
  const [users, lics, hubs, keys] = await Promise.all([
    db.select().from(schema.users).orderBy(asc(schema.users.role), asc(schema.users.name)),
    db.select().from(schema.licensees).orderBy(asc(schema.licensees.sortOrder), asc(schema.licensees.name)),
    db.select().from(schema.hubs).orderBy(asc(schema.hubs.licenseeId), asc(schema.hubs.name)),
    db.select().from(schema.apiKeys).orderBy(asc(schema.apiKeys.createdAt)),
  ]);
  const active = lics.filter((l) => l.active);
  return (
    <section className="view">
      <div>
        <h2>Administration</h2>
        <p className="sub">Manage who can sign in and which licensees report to the Hub. Licensee officers only see and submit their own organisation&apos;s returns. Band floors, thresholds, targets and forecast assumptions are under <a href="/admin/settings">Settings</a>.</p>
      </div>
      <div className="card">
        <h3>Users</h3>
        <div className="scroll">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Licensee</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="lic">{u.name}<small>{u.email}</small></td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{lics.find((l) => l.id === u.licenseeId)?.name ?? "—"}</td>
                  <td>
                    {!u.active ? <span className="pill s-missing">Deactivated</span>
                      : u.role === "licensee" && !lics.find((l) => l.id === u.licenseeId)?.active ? <span className="pill s-missing">Licensee retired</span>
                      : <span className="pill s-validated">Active</span>}
                    {u.active && u.mustChangePassword && <small style={{ display: "block", color: "var(--muted)", fontSize: 12, marginTop: 3 }}>Temporary password</small>}
                  </td>
                  <td>
                    <div className="actions">
                      <ResetPasswordForm id={u.id} />
                      {u.id !== me.uid && (
                        <form action={toggleUser}><input type="hidden" name="id" value={u.id} /><button type="submit">{u.active ? "Deactivate" : "Reactivate"}</button></form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <NewUserForm licensees={active.map((l) => ({ id: l.id, name: l.name, area: l.area }))} />
      <div className="card">
        <h3>Licensees</h3>
        <div className="scroll">
          <table>
            <thead><tr><th>Licensee</th><th>Type</th><th>Licence status</th><th>Reports</th><th /></tr></thead>
            <tbody>
              {lics.map((l) => (
                <tr key={l.id}>
                  <td className="lic">{l.code} — {l.name}<small>{l.area} · ID {l.id}</small></td>
                  <td>{l.type}</td>
                  <td>{l.licenceStatus}</td>
                  <td style={{ fontSize: 13 }}>{l.obligations.map((d) => DATASETS[d].short).join(", ")}</td>
                  <td><form action={toggleLicensee}><input type="hidden" name="id" value={l.id} /><button type="submit">{l.active ? "Retire" : "Restore"}</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <LicenseeForm />
      <div className="card">
        <h3>Business hubs</h3>
        <p className="sub small">Other spellings used in licensee files, separated by commas. Uploads match hubs by any of these names, so IJEBU-ODE, Ijebu and IJEBU land in one hub.</p>
        <div className="scroll">
          <table className="compact">
            <thead><tr><th>Licensee</th><th>Hub</th><th>Also known as</th></tr></thead>
            <tbody>
              {hubs.map((h) => (
                <tr key={h.id}>
                  <td>{lics.find((l) => l.id === h.licenseeId)?.name}</td>
                  <td>{h.name}</td>
                  <td>
                    <form action={saveHubAliases} className="actions">
                      <input type="hidden" name="id" value={h.id} />
                      <input name="aliases" defaultValue={h.aliases.join(", ")} aria-label={`Other names for ${h.name}`} style={{ minWidth: 220 }} />
                      <button type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3>API keys</h3>
        {keys.length ? (
          <div className="scroll">
            <table className="compact">
              <thead><tr><th>Licensee</th><th>Purpose</th><th>Key starts</th><th>Last used</th><th>Status</th><th /></tr></thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{lics.find((l) => l.id === k.licenseeId)?.name}</td><td>{k.label}</td><td><code>{k.prefix}…</code></td>
                    <td style={{ fontSize: 13 }}>{k.lastUsedAt ? k.lastUsedAt.toLocaleDateString("en-GB") : "Never"}</td>
                    <td>{k.revokedAt ? <span className="pill s-missing">Revoked</span> : <span className="pill s-validated">Active</span>}</td>
                    <td>{!k.revokedAt && <form action={revokeApiKey}><input type="hidden" name="id" value={k.id} /><button type="submit">Revoke</button></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="sub small">No keys issued.</p>}
      </div>
      <ApiKeyForm licensees={active.map((l) => ({ id: l.id, name: l.name }))} />
    </section>
  );
}
