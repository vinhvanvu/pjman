// ⌘K: jump to any record by key or title. The one place search exists; it follows the link rule on pick.
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { Lens, RecordType, Row } from '@/data/contract';
import { useRecords } from '@/data/queries';
import { short, targetOf } from '@/lib/keys';
import { StatusChip } from '@/components/chips/Chip';

const GROUPS: { type: RecordType; label: string }[] = [
  { type: 'product', label: 'Products' },
  { type: 'feature', label: 'Features' },
  { type: 'project', label: 'Projects' },
  { type: 'change', label: 'Changes' },
  { type: 'decision', label: 'Decisions' },
  { type: 'session', label: 'Sessions' },
];

export function useCommandPaletteHotkey(onOpen: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

export function CommandPalette({
  open,
  onOpenChange,
  lens,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lens: Lens;
}) {
  const navigate = useNavigate();
  const { data } = useRecords({}, open);
  const byType = useMemo(() => {
    const m = new Map<RecordType, Row[]>();
    for (const r of data ?? []) {
      if (r.type === 'source' || r.type === 'actor') continue;
      if (r.type === 'change' && (r.status === 'done' || r.status === 'dropped')) continue;
      m.set(r.type, [...(m.get(r.type) ?? []), r]);
    }
    return m;
  }, [data]);

  const go = (key: string) => {
    onOpenChange(false);
    const t = targetOf(key, lens);
    if (t.kind === 'node') void navigate({ to: '/$lens/$', params: { lens: t.lens, _splat: t.node }, search: {} });
    else if (t.kind === 'session') void navigate({ to: '/session/$id', params: { id: t.id } });
    else if (t.kind === 'get') void navigate({ to: '/get/$', params: { _splat: t.key } });
    else window.open(t.url, '_blank', 'noreferrer');
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Jump to" description="Any record, by key or title">
      <Command loop>
        <CommandInput placeholder="Jump to a feature, change, decision, session…" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>Nothing by that name.</CommandEmpty>
          {GROUPS.map(({ type, label }) => {
            const rows = byType.get(type);
            if (!rows?.length) return null;
            return (
              <CommandGroup key={type} heading={label}>
                {rows.map((r) => (
                  <CommandItem
                    key={r.key}
                    value={`${r.key} ${r.title ?? ''} ${typeof r.data.name === 'string' ? r.data.name : ''}`}
                    onSelect={() => go(r.key)}
                    className="gap-2"
                  >
                    <span className="truncate">
                      {typeof r.data.name === 'string' ? r.data.name : (r.title ?? short(r.key))}
                    </span>
                    {r.type === 'change' && <StatusChip status={r.status} className="ml-auto" />}
                    <span className="ml-auto font-mono text-meta text-ink-faint">{short(r.key)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
