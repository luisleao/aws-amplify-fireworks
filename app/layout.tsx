import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fogos de artifício",
  description: "Escolha uma animação e uma cor e veja seu fogo estourar no telão.",
};

export const viewport: Viewport = {
  themeColor: "#070a1a",
  // O seletor é feito para uma mão só, de pé, no escuro: sem zoom acidental.
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={geistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
