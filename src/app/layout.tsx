import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InnovaPM Mail Campaign",
  description: "Prywatny panel do zarządzania kampaniami mailowymi InnovaPM.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
