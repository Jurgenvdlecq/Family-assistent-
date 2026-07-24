import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const household = await prisma.household.findFirst({
    orderBy: { createdAt: "asc" },
    include: { persons: true },
  });

  if (!household) {
    redirect("/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <p className="mb-2 font-mono text-xs uppercase tracking-wide text-orange-600">
        Onboarding voltooid
      </p>
      <h1 className="mb-2 text-3xl font-semibold">Welkom, {household.name}</h1>
      <p className="mb-6 text-neutral-600 dark:text-neutral-400">
        {household.persons.length} gezinslid/leden geregistreerd:{" "}
        {household.persons.map((p) => p.name).join(", ")}.
      </p>
      <p className="text-sm text-neutral-500 dark:text-neutral-500">
        &ldquo;Jouw week&rdquo; — de wekelijkse planning — volgt in fase 1 van de
        ontwikkelstrategie.
      </p>
    </main>
  );
}
