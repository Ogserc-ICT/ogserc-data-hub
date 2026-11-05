import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
const mono = localFont({
  src: "./fonts/JetBrainsMonoVariable.woff2",
  weight: "100 800",
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OGSERC Data Hub",
  description: "Regulatory returns from Ogun State electricity licensees.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
