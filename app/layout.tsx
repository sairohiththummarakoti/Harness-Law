import type { Metadata } from "next";
import "./globals.css";
import { AnalyticsTracker } from "@/components/analytics-tracker";

export const metadata: Metadata = {
  title: "Harness Law — Your applicant workspace",
  description: "Bring your evidence, your story, and your application together in one thoughtful workspace.",
  icons: {
    icon: [
      { url: "/favicon-16.png?v=puzzle-1", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png?v=puzzle-1", sizes: "32x32", type: "image/png" },
      { url: "/favicon-192.png?v=puzzle-1", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=puzzle-1",
    apple: "/apple-touch-icon.png?v=puzzle-1",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}<AnalyticsTracker /></body>
    </html>
  );
}
