import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Family Assistant",
  description: "Jullie gezinsassistent voor maaltijden en boodschappen.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    // iOS ondersteunt web push alléén als de app als PWA op het
    // beginscherm staat (iOS 16.4+) — dit maakt "Zet op beginscherm"
    // vanuit Safari mogelijk als standalone app in plaats van een tabblad.
    capable: true,
    title: "Family Assistant",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  // Nodig zodat env(safe-area-inset-bottom) een echte waarde teruggeeft —
  // zonder viewport-fit=cover tekent de standalone PWA (na "Zet op
  // beginscherm") tot onder de iPhone-thuisbalk, en botst de onderste
  // navigatie daarmee.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
