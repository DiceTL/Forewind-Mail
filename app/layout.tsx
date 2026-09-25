import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forewind Mail",
  description: "Lightweight email reminders ahead of your deadlines.",
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
