import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Red_Hat_Display } from "next/font/google";
import "./globals.css";

const redHatDisplay = Red_Hat_Display({
  variable: "--font-red-hat-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"]
});

export const metadata: Metadata = {
  title: "SILENCE | Private Payroll Onchain",
  description: "Wallet-gated encrypted payroll on Solana devnet and Arcium"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={redHatDisplay.variable}>
      <body>{children}</body>
    </html>
  );
}
