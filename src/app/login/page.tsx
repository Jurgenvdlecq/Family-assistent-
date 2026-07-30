import Link from "next/link";
import { LockKeyhole, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentHousehold } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loginToHousehold } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const currentHousehold = await getCurrentHousehold();
  if (currentHousehold) redirect("/");

  const params = await searchParams;
  // Bewust geen huishoudens ophalen om te tonen: een lijst met
  // huishoudennamen op een gedeeld, publiek loginscherm zou de namen van
  // andere gezinnen die deze app gebruiken lekken aan iedere bezoeker
  // (WP62). Gebruikersnaam+wachtwoord is genoeg — welk huishouden erbij
  // hoort wordt server-side afgeleid uit de combinatie zelf.
  const hasAnyHousehold = (await prisma.household.count({ where: { username: { not: null } } })) > 0;

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-xl flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <LockKeyhole size={22} />
        </div>
        <h1 className="mb-2 text-3xl font-semibold text-ink">Welkom terug</h1>
        <p className="text-ink-muted">Log in met jullie gebruikersnaam en wachtwoord.</p>
      </div>

      {!hasAnyHousehold ? (
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="mb-4 text-sm text-ink-muted">
            Er is nog geen huishouden met inloggegevens. Maak een nieuw huishouden aan om te beginnen.
          </p>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
          >
            <Plus size={16} />
            Nieuw huishouden
          </Link>
        </div>
      ) : (
        <form action={loginToHousehold} className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface p-4">
          {params.status === "wrong-credentials" && (
            <p className="mb-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
              Deze inloggegevens kloppen niet. Probeer het opnieuw.
            </p>
          )}
          <input
            type="text"
            name="username"
            minLength={3}
            required
            autoFocus
            autoComplete="username"
            placeholder="Gebruikersnaam"
            className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          />
          <input
            type="password"
            name="password"
            minLength={6}
            required
            autoComplete="current-password"
            placeholder="Wachtwoord"
            className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="mt-2 shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
          >
            Openen
          </button>
        </form>
      )}

      <Link href="/onboarding" className="mt-6 text-sm font-medium text-accent hover:opacity-80">
        Nieuw huishouden maken
      </Link>
    </div>
  );
}
