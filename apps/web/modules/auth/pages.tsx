import { getAuthReadiness } from "./server";
import { CodePage as CodeScreen } from "./ui/CodePage";
import { InvitePage as InviteScreen } from "./ui/InvitePage";
import { LoginPage as LoginScreen } from "./ui/LoginPage";
import { SessionsPage as SessionsScreen } from "./ui/SessionsPage";

export { AuthEmail } from "./ui/AuthEmail";
export { AuthFrame } from "./ui/AuthFrame";
export function LoginPage() {
  return <LoginScreen readiness={getAuthReadiness("login")} />;
}
export function CodePage() {
  return <CodeScreen readiness={getAuthReadiness("code")} />;
}
export function InvitePage() {
  return <InviteScreen readiness={getAuthReadiness("invite")} />;
}
export function SessionsPage() {
  return <SessionsScreen readiness={getAuthReadiness("sessions")} />;
}
