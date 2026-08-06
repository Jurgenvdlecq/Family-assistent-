import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentHousehold } from "@/lib/auth";
import PicnicConnection from "@/app/ons-gezin/PicnicConnection";

// Laatste stap van onboarding, altijd overslaanbaar: nooit stilzwijgend
// dwingen om Picnic te koppelen (AGENTS.md, "geen schijnfunctionaliteit").
export const dynamic = "force-dynamic";

export default async function OnboardingPicnicPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const household = await requireCurrentHousehold();

  // Al gekoppeld (bv. iemand keert terug op deze url) — niets meer te doen hier.
  if (household.picnicAuthToken) {
    redirect("/");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-xl flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs uppercase tracking-wide text-accent">Laatste stap</p>
        <h1 className="mb-2 text-2xl font-semibold text-ink">Koppel je Picnic-account</h1>
        <p className="text-ink-muted">
          Optioneel, maar dan kan ik jullie boodschappen straks rechtstreeks in het Picnic-mandje
          zetten. Dit kan ook later via Ons gezin.
        </p>
      </div>

      <PicnicConnection
        householdId={household.id}
        connected={false}
        pendingTwoFactor={Boolean(household.picnicPendingAuthToken)}
        status={params.status}
        returnTo="/onboarding/picnic"
      />

      <Link
        href="/"
        className="mt-2 text-center text-sm font-medium text-ink-muted hover:text-ink"
      >
        Overslaan, dit doe ik later →
      </Link>
    </div>
  );
}
