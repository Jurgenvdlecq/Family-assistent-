"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, UtensilsCrossed, BookOpen, ShoppingCart, ClipboardCheck, Users, Loader2 } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Jouw week", icon: Home },
  { href: "/gerechten", label: "Gerechten", icon: UtensilsCrossed },
  { href: "/recepten", label: "Recepten", icon: BookOpen },
  { href: "/boodschappen", label: "Boodschappen", icon: ShoppingCart },
  { href: "/controle", label: "Controle", icon: ClipboardCheck },
  { href: "/ons-gezin", label: "Ons gezin", icon: Users },
];

export default function NavBar() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-stretch justify-around px-2">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          const pending = pendingHref === item.href && !active;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={() => {
                if (!active) setPendingHref(item.href);
              }}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-medium transition-all duration-150 hover:-translate-y-0.5 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 active:scale-[0.97] ${
                active || pending ? "bg-accent/10" : ""
              }`}
            >
              {pending ? (
                <Loader2 size={22} className="animate-spin text-accent" />
              ) : (
                <Icon
                  size={22}
                  strokeWidth={active ? 2.25 : 1.75}
                  className={active ? "text-accent" : "text-ink-faint"}
                />
              )}
              <span className={`max-w-full truncate text-center ${active || pending ? "text-accent" : "text-ink-muted"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
