/**
 * Eenmalig, lokaal in te loggen bij Picnic. Draai dit zelf in je Terminal:
 *
 *     npx tsx scripts/picnic-login.ts
 *
 * Je gebruikersnaam en wachtwoord worden alleen gebruikt om rechtstreeks
 * met Picnic te praten (via de niet-officiële API — zie risico R1 in het
 * ontwerpdocument) en daarna meteen weggegooid. Alleen het resulterende
 * sessie-token wordt opgeslagen, in de database, bij jullie huishouden.
 * Dit script slaat niets op schijf op buiten de database.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/prisma";
import { PicnicClient, Picnic2FARequiredError } from "../src/lib/picnic/client";

async function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  // @ts-expect-error -- _writeToOutput is een ongedocumenteerde, maar
  // stabiele readline-hook om het echoën van typen uit te zetten.
  const originalWrite = rl._writeToOutput;
  // @ts-expect-error zie hierboven
  rl._writeToOutput = function hidden(stringToWrite: string) {
    if (stringToWrite.trim() === question.trim()) {
      originalWrite.call(rl, stringToWrite);
    }
  };
  const answer = await rl.question(question);
  rl.close();
  stdout.write("\n");
  return answer;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

async function main() {
  console.log("Picnic-koppeling — eenmalig inloggen\n");

  const household = await prisma.household.findFirstOrThrow({
    orderBy: { createdAt: "asc" },
  });

  const username = await ask("Picnic e-mailadres: ");
  const password = await askHidden("Picnic wachtwoord (niet zichtbaar): ");

  const client = new PicnicClient();

  try {
    await client.login(username, password);
  } catch (err) {
    if (err instanceof Picnic2FARequiredError) {
      console.log("\nPicnic vraagt om een SMS-verificatiecode.");
      await client.generate2FACode("SMS");
      const code = await ask("Code uit sms: ");
      await client.verify2FACode(code);
    } else {
      throw err;
    }
  }

  const token = client.getAuthToken();
  if (!token) {
    throw new Error("Inloggen leek te lukken, maar er kwam geen sessie-token terug.");
  }

  await prisma.household.update({
    where: { id: household.id },
    data: { picnicAuthToken: token, picnicTokenUpdatedAt: new Date() },
  });

  console.log(`\nGelukt — Picnic is gekoppeld aan huishouden "${household.name}".`);
  console.log("Je kunt dit venster nu sluiten. Het wachtwoord is nergens opgeslagen.");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\nInloggen mislukt:", err instanceof Error ? err.message : err);
  process.exit(1);
});
