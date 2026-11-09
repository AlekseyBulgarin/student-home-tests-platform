import type { ReactNode } from "react";
import { GraduationCap, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { Button } from "@/components/ui/button";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Включить светлую тему" : "Включить тёмную тему";
  return <Button type="button" variant="ghost" size="icon" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={label} title={label}>
    {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
  </Button>;
}

export function AppShell({ children, onSignOut }: { children: ReactNode; onSignOut?: () => void }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2 font-semibold" aria-label="КлассТест — главная">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><GraduationCap aria-hidden="true" /></span>
            <span>КлассТест</span>
          </a>
          <div className="flex items-center gap-1"><ThemeToggle />{onSignOut ? <Button variant="ghost" onClick={onSignOut}><LogOut data-icon="inline-start" />Выйти</Button> : null}</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
