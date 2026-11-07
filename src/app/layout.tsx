import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Bundled with the app so builds don't need to reach Google Fonts (self-hosted servers).
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

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
