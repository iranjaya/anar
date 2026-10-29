import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { DemoBar } from "@/modules/tenant/pages";
import { getDemoControls } from "@/modules/tenant/server";
import "./globals.css";

const title = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-title",
});
const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-code",
});

export const metadata: Metadata = { title: "Anar" };

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authScreen = (await headers()).get("x-anar-auth-screen") === "1";
  const controls = authScreen ? null : await getDemoControls();
  return (
    <html lang="en">
      <body className={`${title.variable} ${body.variable} ${mono.variable}`}>
        {controls && <DemoBar {...controls} />}
        {children}
      </body>
    </html>
  );
}
