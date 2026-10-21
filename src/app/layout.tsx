import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Muwa Gin", template: "%s · Muwa Gin" },
  description: "Muwa Gin company management",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Muwa Gin", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0f4f3a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
