// The theme picker in the rail, and the hook that keeps the document on the chosen theme.
import { cn } from 'cn';
import { Check, SunMoon } from 'lucide-react';
import { useEffect } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { railItem } from '@/components/shell/Rail';
import { usePreferences } from '@/state/preferences';
import { applyTheme, THEMES } from '@/themes';

export function useApplyTheme(): void {
  const theme = usePreferences((s) => s.theme);
  useEffect(() => applyTheme(theme), [theme]);
}

export function ThemePicker({ className }: { className?: string }) {
  const theme = usePreferences((s) => s.theme);
  const setTheme = usePreferences((s) => s.setTheme);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(railItem, 'w-full', className)} aria-label={`Theme: ${current.name}`}>
        <SunMoon className="size-[15px] shrink-0" />
        <span className="truncate">{current.name}</span>
        <span className="ml-auto text-xs font-normal text-ink-faint">theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[200px]">
        <DropdownMenuLabel className="label">Themes that ship</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => setTheme(t.id)} className="gap-2">
            <span
              data-theme={t.id}
              className="size-3.5 rounded-full border border-line-strong"
              style={{ background: 'var(--primary)' }}
              aria-hidden="true"
            />
            <span className="flex-1">{t.name}</span>
            <span className="text-xs text-ink-faint">{t.kind}</span>
            {t.id === theme && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
