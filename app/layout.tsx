import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harness Law — Your applicant workspace",
  description: "Bring your evidence, your story, and your application together in one thoughtful workspace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
