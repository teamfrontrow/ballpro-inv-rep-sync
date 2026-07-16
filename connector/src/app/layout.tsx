import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ToastProvider } from "@/components/ui";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "BallPro Inventory", template: "%s | BallPro Inventory" },
  description: "RepSpark to Shopify inventory connector control plane",
};

const themeScript = `
  try {
    var saved = localStorage.getItem("ballpro-theme");
    document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  } catch (_) {
    document.documentElement.dataset.theme = "dark";
  }
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
