import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Miseiri 見整理 — NZBN spreadsheet cleanser",
  description:
    "Free spreadsheet enrichment against the New Zealand Business Number register. Browser-first, no data stored.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
