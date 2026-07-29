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
  // (WP62). Eén toegangscode-veld is genoeg — welk huishouden erbij hoort
  // wordt server-side afgeleid uit de code zelf.
  const hasAnyHousehold = (await prisma.household.count({ where: { accessCodeHash: { not: null } } })) > 0;

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-xl flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <LockKeyhole size={22} />
        </div>
        <h1 className="mb-2 text-3xl font-semibold text-ink">Welkom terug</h1>
        <p className="text-ink-muted">Voer jullie toegangscode in.</p>
      </div>

      {!hasAnyHousehold ? (
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="mb-4 text-sm text-ink-muted">
            Er is nog geen huishouden met een toegangscode. Maak een nieuw huishouden aan om te beginnen.
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
        <form action={loginToHousehold} className="rounded-xl border border-line bg-surface p-4">
          {params.status === "wrong-code" && (
            <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
              Deze toegangscode klopt niet. Probeer het opnieuw.
            </p>
          )}
          <div className="flex min-w-0 gap-2">
            <input
              type="password"
              name="accessCode"
              minLength={6}
              required
              autoFocus
              placeholder="Toegangscode"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
            >
              Openen
            </button>
          </div>
        </form>
      )}

      <Link href="/onboarding" className="mt-6 text-sm font-medium text-accent hover:opacity-80">
        Nieuw huishouden maken
      </Link>
    </div>
  );
}
