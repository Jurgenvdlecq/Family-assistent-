"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ShoppingCart, Users, Loader2 } from "lucide-react";

// label is de volledige naam (voor aria-label); shortLabel is wat er
// echt staat. Op een gewone telefoonbreedte (~375-390px) werden "Jouw
// week" en "Boodschappen" afgekapt tot onleesbare "Jouw wee…"/"Boodsch…"
// — de balk staat op elk scherm in beeld, dus dit moet altijd passen.
//
// Bewust teruggebracht van 6 naar 3 tegels (UX-review): "Gerechten" is
// geen bestemming maar een contextuele actie (vervang dít gerecht op déze
// dag, vereist een dag) — al bereikbaar via links vanaf "/" en
// "/boodschappen". "Controle" is stap 2 van de boodschappenflow, geen
// aparte behoefte — al bereikbaar via een link vanaf "/boodschappen".
// "Recepten" is technisch receptbeheer, laagfrequent — verplaatst naar
// een link binnen "Ons gezin".
//
// Boodschappen staat sinds de koerswijziging "boodschappen eerst" vooraan:
// dat is waarvoor de app in de praktijk geopend wordt. Het weekmenu is
// verhuisd van "/" naar "/week" en staat nu op plek twee. De tegel linkt
// rechtstreeks naar "/boodschappen" en niet naar "/", zodat dagelijks
// gebruik geen extra doorverwijzing kost ("/" blijft bestaan als voordeur
// voor bladwijzers en voor de stap na inloggen/onboarding).
const ITEMS = [
  { href: "/boodschappen", label: "Boodschappen", shortLabel: "Boodschappen", icon: ShoppingCart },
  { href: "/week", label: "Jouw week", shortLabel: "Week", icon: CalendarDays },
  { href: "/ons-gezin", label: "Ons gezin", shortLabel: "Gezin", icon: Users },
];

export default function NavBar() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface [transform:translateZ(0)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
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
              aria-label={item.label}
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
                {item.shortLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
