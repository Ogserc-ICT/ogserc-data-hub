import { requireUser } from "@/lib/auth";
import ChangePasswordForm from "./ChangePasswordForm";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <section className="view">
      <div>
        <h2>Your account</h2>
        {user.mcp ? (
          <p className="notice" role="status" style={{ maxWidth: 480 }}>
            You signed in with a temporary password from the Commission. Choose your own password to continue.
          </p>
        ) : (
          <p className="sub">Change your password here. Changing it signs you out on every other device.</p>
        )}
      </div>
      <ChangePasswordForm />
    </section>
  );
}
