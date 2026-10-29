import { redirect } from "next/navigation";
import { getAuthReadiness, getSession, listSessions } from "./server";
import { CodePage as CodeScreen } from "./ui/CodePage";
import { InvitePage as InviteScreen } from "./ui/InvitePage";
import { LoginPage as LoginScreen } from "./ui/LoginPage";
import { SessionsPage as SessionsScreen } from "./ui/SessionsPage";

export { AuthEmail } from "./ui/AuthEmail";
export { AuthFrame } from "./ui/AuthFrame";
export {
  AccountPage,
  CompanyAccessFrame,
  CompanyHomePage,
  SessionHomePage,
  WorkspacesPage,
} from "./ui/SessionPages";

export async function LoginPage() {
  const session = await getSession();
  if (session?.ok) redirect(session.data.redirectTo);
  return (
    <>
      {session && !session.ok && session.error !== "unauthorized" && (
        <p role="alert" className="mb-4 text-sm text-overdue">
          {session.message}
        </p>
      )}
      <LoginScreen readiness={getAuthReadiness("login")} />
    </>
  );
}
export async function CodePage() {
  const session = await getSession();
  if (session?.ok) redirect(session.data.redirectTo);
  return <CodeScreen readiness={getAuthReadiness("code")} />;
}
export function InvitePage() {
  return <InviteScreen readiness={getAuthReadiness("invite")} />;
}
export async function SessionsPage() {
  const session = await getSession();
  if (session && !session.ok && session.error === "unauthorized")
    redirect("/login");
  return (
    <SessionsScreen
      readiness={getAuthReadiness("sessions")}
      result={await listSessions()}
    />
  );
}
