import type { Metadata } from "next";
import { Source_Serif_4, Shippori_Mincho, Zen_Kaku_Gothic_New } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});
const shipporiMincho = Shippori_Mincho({
  variable: "--font-mincho",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});
const zenKakuGothic = Zen_Kaku_Gothic_New({
  variable: "--font-gothic",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Miseiri 見整理 — NZBN spreadsheet cleanser",
  description:
    "Free spreadsheet enrichment against the New Zealand Business Number register. Browser-first, no data stored.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sourceSerif.variable} ${shipporiMincho.variable} ${zenKakuGothic.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <SiteNav />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
