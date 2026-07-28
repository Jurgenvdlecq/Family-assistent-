"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";

function redirectToOnsGezin(status: string): never {
  revalidatePath("/ons-gezin");
  redirect(`/ons-gezin?status=${encodeURIComponent(status)}`);
}

export async function dismissLearnedPattern(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const patternId = String(formData.get("patternId"));

  const pattern = await prisma.learnedPattern.findFirstOrThrow({
    where: { id: patternId, householdId },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.learningPrompt.updateMany({
      where: { householdId, learnedPatternId: pattern.id, status: "PENDING" },
      data: { status: "DISMISSED", answeredAt: new Date() },
    }),
    prisma.learnedPattern.update({
      where: { id: pattern.id },
      data: { status: "DISMISSED", confidence: 0.1 },
    }),
  ]);

  revalidatePath("/");
  redirectToOnsGezin("learned-pattern-dismissed");
}
