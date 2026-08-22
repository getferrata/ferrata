import type { Metadata } from "next";
import "./globals.css";

/**
 * Where this install answers from, for the absolute URLs in social previews.
 *
 * A self-hosted app does not know its own address at build time, which is why
 * this was left unset, and Next then warned twice on every build of every
 * install and resolved preview images against localhost. Reading it from the
 * environment costs one variable and removes both: set it and the previews
 * work, leave it and they point at the local port, which is where the app is.
 */
const publicUrl =
  process.env.FERRATA_PUBLIC_URL?.trim() ||
  `http://localhost:${process.env.PORT ?? 3000}`;

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl),
  title: {
    default: "Ferrata",
    template: "%s · Ferrata",
  },
  description:
    "Turn your material and context into a verified, deadline-aware learning path.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `suppressHydrationWarning` because the inline script below stamps
  // data-theme on <html> before React hydrates, to avoid a theme flash.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ferrata-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">
        {children}
      </body>
    </html>
  );
}
