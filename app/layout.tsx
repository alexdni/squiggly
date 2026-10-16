import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Squiggly · EEG Assessment Platform",
    template: "%s · Squiggly",
  },
  description: "Rapid, transparent, open-source EEG analysis platform for 19-channel recordings",
  applicationName: "Squiggly",
};

export const viewport: Viewport = {
  themeColor: "#773DFF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
