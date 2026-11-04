import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({ src: "./fonts/Geist-latin.woff2", variable: "--font-geist-sans", weight: "100 900", display: "swap" });
const geistMono = localFont({ src: "./fonts/GeistMono-latin.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "Errandly",
  description: "A shopping agent that spends only what you allow. Mandates, a policy engine, and PayPal vaulted payments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
