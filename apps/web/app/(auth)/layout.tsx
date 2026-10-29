import { AuthEmail, AuthFrame } from "@/modules/auth/pages";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthEmail>
      <AuthFrame>{children}</AuthFrame>
    </AuthEmail>
  );
}
