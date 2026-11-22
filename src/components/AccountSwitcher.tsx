"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Account } from "@/lib/accounts/types";
import { netWorthOf } from "@/lib/finance/debt";
import { useI18n } from "@/lib/i18n/I18nProvider";

/** Assets − liabilities, the same net worth as the hero. */
const netWorth = (a: Account) => netWorthOf(a.profile);

/** "Barlas" → "B", "Anna Muster" → "AM". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.[0] ?? "?").toUpperCase();
}

function Avatar({ name, active }: { name: string; active?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${active ? "bg-ink text-bg" : "bg-surface-2 text-ink-2"}`}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Header account switcher: a menu button showing the active account (initials, name, net worth).
 * Keyboard: Enter / Space / ↓ open the menu on the current account, ↑ / ↓ / Home / End move, Enter / Space
 * select, Escape closes and returns focus, Tab closes.
 */
export function AccountSwitcher({
  accounts,
  activeId,
  onSelect,
  onReset,
  onDelete,
  onNewAccount,
  onOpenUbs,
}: {
  accounts: Account[];
  activeId: string;
  onSelect: (id: string) => void;
  onReset: (id: string) => void;
  onDelete?: (id: string) => void;
  onNewAccount?: () => void;
  /** "Open a UBS profile…" (synthetic starter data). */
  onOpenUbs?: () => void;
}) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const getItems = () => itemRefs.current.filter((el): el is HTMLButtonElement => Boolean(el && el.isConnected));

  const focusItem = (i: number) => {
    const items = getItems();
    if (!items.length) return;
    items[(i + items.length) % items.length].focus();
  };
  // Focus moves in the same commit that renders the menu, so fast key presses land on the menu items.
  const pendingFocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (open && pendingFocus.current !== null) {
      focusItem(pendingFocus.current);
      pendingFocus.current = null;
    }
  });
  const openMenu = (focus: "active" | "last" = "active") => {
    pendingFocus.current = focus === "last" ? -1 : Math.max(0, accounts.findIndex((a) => a.id === activeId));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu("active");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu("last");
    }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const items = getItems();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(-1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("header.switchAria", { name: active.profile.name })}
        title={t("header.switchAria", { name: active.profile.name })}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKey}
        className="flex max-w-full min-w-0 items-center gap-2 rounded-full border border-line bg-surface py-0.5 pr-2.5 pl-0.5 text-xs font-medium transition hover:border-ink-3"
      >
        <Avatar name={active.profile.name} active />
        <span className="truncate">{active.profile.name}</span>
        <span className="num shrink-0 text-ink-3">{fmt.chf(netWorth(active))}</span>
        <span aria-hidden="true" className="shrink-0 text-[10px] text-ink-3">▾</span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("header.menu")}
          onKeyDown={onMenuKey}
          className="card absolute top-full left-0 z-50 mt-1.5 max-h-[min(32rem,calc(100vh-8rem))] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto p-1.5 shadow-lg sm:right-0 sm:left-auto"
        >
          <div className="label px-2 pt-1 pb-1.5">{t("header.menu")}</div>
          {accounts.map((a, i) => {
            const current = a.id === active.id;
            return (
              <button
                key={a.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                tabIndex={-1}
                onClick={() => {
                  close();
                  if (!current) onSelect(a.id);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent ${current ? "bg-surface-2" : "hover:bg-surface-2"}`}
              >
                <Avatar name={a.profile.name} active={current} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{a.profile.name}</span>
                    {a.ubs && <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold text-ink-2">{t("ubs.tag")}</span>}
                  </span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {a.profile.city} · {t("header.netWorth", { amount: netWorth(a) })}
                  </span>
                </span>
                <span aria-hidden="true" className={`text-xs ${current ? "text-ink" : "text-transparent"}`}>✓</span>
              </button>
            );
          })}
          <div className="my-1 border-t border-line" role="none" />
          <button
            ref={(el) => {
              itemRefs.current[accounts.length] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              close();
              onReset(active.id);
            }}
            className="w-full rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="block font-medium">{t("header.reset")}</span>
            <span className="block text-[11px] text-ink-3">
              {t("header.resetHint")}
              {active.localChanges > 0 && <>{" · "}{t("header.localChanges", { count: active.localChanges })}</>}
            </span>
          </button>
          {!active.builtIn && onDelete && (
            <button
              ref={(el) => {
                itemRefs.current[accounts.length + 1] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                onDelete(active.id);
              }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-bad outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="block font-medium">{t(active.ubs ? "ubs.closeProfile" : "data.deleteAccount")}</span>
              <span className="block text-[11px] text-ink-3">{t(active.ubs ? "ubs.closeProfileHint" : "data.deleteAccountHint")}</span>
            </button>
          )}
          {onNewAccount && (
            <button
              ref={(el) => {
                itemRefs.current[accounts.length + 2] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(false);
                onNewAccount();
              }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="block font-medium">{t("data.newAccount")}</span>
              <span className="block text-[11px] text-ink-3">{t("data.newAccountHint")}</span>
            </button>
          )}
          {onOpenUbs && (
            <button
              ref={(el) => {
                itemRefs.current[accounts.length + 3] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-testid="open-ubs"
              onClick={() => {
                close(false);
                onOpenUbs();
              }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="block font-medium">{t("ubs.openProfile")}</span>
              <span className="block text-[11px] text-ink-3">{t("ubs.openProfileHint")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
