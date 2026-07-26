import Link from "next/link";
import { Wordmark } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { AppNav } from "./app-nav";

/** App chrome: wordmark, the role-aware main menu, theme and account. */
export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="border-b border-border">
      {/* Wraps to a second row on narrow screens instead of pushing the page
          sideways: the menu keeps every destination reachable on a phone. */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3 sm:h-14 sm:flex-nowrap sm:py-0">
        <div className="order-1 flex min-w-0 shrink-0 items-center gap-6">
          <Link href="/courses" aria-label="Ferrata: my courses" className="shrink-0">
            <Wordmark />
          </Link>
          <div className="hidden sm:block">
            <AppNav />
          </div>
        </div>
        <div className="header-slot order-2 flex shrink-0 items-center gap-3">
          {right}
          <ThemeToggle />
          <UserMenu />
        </div>
        <div className="order-3 w-full sm:hidden">
          <AppNav />
        </div>
      </div>
    </header>
  );
}
