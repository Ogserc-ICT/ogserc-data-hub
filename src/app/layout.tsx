import type { Metadata } from "next";
import { Archivo, Source_Sans_3, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-archivo" });
const source = Source_Sans_3({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-source" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "OGSERC Data Hub",
  description: "Regulatory returns from Ogun State electricity licensees.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${archivo.variable} ${source.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
