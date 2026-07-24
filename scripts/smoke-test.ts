import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const household = await prisma.household.create({
    data: {
      name: "Testgezin",
      persons: {
        create: [{ name: "Jurgen", role: "PARENT" }],
      },
    },
    include: { persons: true },
  });

  console.log("Aangemaakt:", household);

  await prisma.person.deleteMany({ where: { householdId: household.id } });
  await prisma.household.delete({ where: { id: household.id } });
  console.log("Opgeruimd — smoke test geslaagd.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
