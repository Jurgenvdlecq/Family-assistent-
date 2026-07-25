"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, UtensilsCrossed, ShoppingCart, ClipboardCheck, Users } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Jouw week", icon: Home },
  { href: "/gerechten", label: "Gerechten", icon: UtensilsCrossed },
  { href: "/boodschappen", label: "Boodschappen", icon: ShoppingCart },
  { href: "/controle", label: "Controle", icon: ClipboardCheck },
  { href: "/ons-gezin", label: "Ons gezin", icon: Users },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-stretch justify-around px-2">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium"
            >
              <Icon
                size={22}
                strokeWidth={active ? 2.25 : 1.75}
                className={active ? "text-accent" : "text-ink-faint"}
              />
              <span className={active ? "text-accent" : "text-ink-muted"}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
