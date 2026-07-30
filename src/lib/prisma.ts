import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Eén gedeelde client, zodat Next.js' hot-reload in dev geen nieuwe
// connectiepool per bestandswijziging opent.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  if (process.env.DEBUG_PRISMA_QUERIES === "true") {
    const client = new PrismaClient({ adapter, log: [{ level: "query", emit: "event" }] });
    client.$on("query" as never, (e: unknown) => {
      console.log("PRISMA_QUERY:", (e as { query: string }).query);
    });
    return client;
  }
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
