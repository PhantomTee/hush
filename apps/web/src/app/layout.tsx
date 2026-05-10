import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Barlow_Condensed, Montserrat } from "next/font/google";
import "./globals.css";

const barlowCondensed = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["700", "800", "900"]
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"]
});

export const metadata: Metadata = {
  title: "SILENCE | Private Payroll Onchain",
  description: "Wallet-gated encrypted payroll on Solana devnet and Arcium"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${montserrat.variable} ${barlowCondensed.variable}`}>
      <body>{children}</body>
    </html>
  );
}
