import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, ShieldAlert, Trash2, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { AppNotificationItem } from '../lib/coordinator';

type FilterTab = 'ALL' | AppNotificationItem['category'];

const FILTER_LABELS: { id: FilterTab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'SIGNAL', label: 'Signals' },
  { id: 'TELEGRAM', label: 'Telegram' },
  { id: 'EXECUTION', label: 'Sandbox' },
  { id: 'SKEPTIC', label: 'Skeptic' },
  { id: 'DIGEST', label: 'Reports' },
];

export function NotificationCenter() {
  const {
    notifications,
    unreadNotificationCount,
    markAllNotificationsRead,
    clearNotifications,
  } = useApp();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const filtered =
    filter === 'ALL'
      ? notifications
      : notifications.filter((n) => n.category === filter);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen && unreadNotificationCount > 0) {
            markAllNotificationsRead();
          }
        }}
        aria-label={`Notification Center (${unreadNotificationCount} unread)`}
        aria-expanded={open}
        className="relative inline-flex items-center justify-center rounded-lg border border-slate-800 bg-[#111827] p-2 text-slate-300 hover:border-[#3b82f6]/60 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadNotificationCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[17px] h-[17px] items-center justify-center rounded bg-[#3b82f6] px-1 font-mono text-[10px] font-bold text-white tabular-nums">
            {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
          </span>
        )}
      </button>

      {open && (
        <section
          aria-label="Notification Center Drawer"
          className="fixed right-3 top-14 sm:absolute sm:right-0 sm:top-11 z-50 w-[calc(100vw-24px)] sm:w-[400px] rounded-xl border border-slate-800 bg-[#0d1323] shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 bg-[#111827]">
            <div>
              <h2 className="font-display text-sm font-bold text-white">
                Notification Center
              </h2>
              <p className="text-[11px] text-slate-400">
                Strict alert feed · Prevents dashboard pop-up clutter
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={markAllNotificationsRead}
                title="Mark all read"
                aria-label="Mark all notifications read"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={clearNotifications}
                title="Clear all"
                aria-label="Clear all notifications"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close Notification Center"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 border-b border-slate-800/80 px-3 py-2 overflow-x-auto bg-[#0a0e1a]">
            {FILTER_LABELS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  filter === tab.id
                    ? 'bg-[#3b82f6] text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-800/70">
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400">
                No notifications in this category yet.
              </div>
            ) : (
              filtered.map((item) => {
                const accent =
                  item.severity === 'success'
                    ? 'text-emerald-400'
                    : item.severity === 'warning'
                    ? 'text-amber-400'
                    : 'text-blue-400';
                return (
                  <div
                    key={item.id}
                    className={`px-4 py-3 text-xs ${
                      item.read ? 'bg-transparent' : 'bg-[#3b82f6]/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-semibold flex items-center gap-1.5 ${accent}`}>
                        {item.category === 'SKEPTIC' && (
                          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        )}
                        {item.title}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 shrink-0 tabular-nums">
                        {new Date(item.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                      {item.message}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
