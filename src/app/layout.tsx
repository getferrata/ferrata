import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
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
