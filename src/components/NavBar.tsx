"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Jouw week" },
  { href: "/gerechten", label: "Gerechten" },
  { href: "/boodschappen", label: "Boodschappen" },
  { href: "/controle", label: "Controle" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-black/95">
      <div className="mx-auto flex max-w-2xl justify-around px-6 py-3 text-sm">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                active
                  ? "font-semibold text-orange-600"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              }
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
