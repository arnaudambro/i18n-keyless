import type { ReactNode } from "react";

// Root layout for the bare `/` route (a redirect to the primary language). The localized
// tree under `[lang]` has its own root layout, so this one is a route group: `next build`
// refuses a page without a root layout, and `next dev` only papers over it.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
