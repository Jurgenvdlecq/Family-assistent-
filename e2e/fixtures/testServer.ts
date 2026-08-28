import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import path from "node:path";

const READY_TIMEOUT_MS = 30_000;

export interface TestServer {
  baseURL: string;
  close(): Promise<void>;
}

async function waitForReady(baseURL: string, deadline: number) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseURL + "/", { redirect: "manual" });
      // 200 (pagina) of 307/302 (bv. redirect naar /onboarding of /login) betekent: de server draait.
      if (res.status < 500) return;
    } catch {
      // Server staat nog niet klaar — gewoon opnieuw proberen.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Testserver op ${baseURL} werd niet op tijd bereikbaar.`);
}

function runToCompletion(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    proc.stdout.on("data", (chunk) => (output += chunk.toString()));
    proc.stderr.on("data", (chunk) => (output += chunk.toString()));
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} mislukte (code ${code}):\n${output.slice(-2000)}`));
    });
  });
}

/**
 * Bouwt eerst een productiebuild en start die daarna (`next build` +
 * `next start`) op een vaste, losstaande poort, met `PICNIC_BASE_URL` al
 * gezet vóórdat de build draait — zo draaien e2e-tests nooit tegen een live
 * Picnic-account en nooit tegen een server die de gebruiker zelf al open
 * heeft staan. `PICNIC_BASE_URL` moet er al bij de build zijn (niet pas bij
 * het starten): de mock-Picnic-server luistert daarom op een vast
 * poortnummer (zie mockPicnicServer.ts) in plaats van een pas na de build
 * toegewezen poort.
 *
 * Bewust `next start` i.p.v. `next dev`: de dev-server heeft een eigen
 * live-herlaad-websocket die zich in deze omgeving onvoorspelbaar gedraagt
 * (soms verbindt hij niet, wat de hele Turbopack-HMR-runtime kan laten
 * hangen). Een productiebuild heeft die websocket helemaal niet nodig en
 * hydrateert daardoor betrouwbaar — bijkomend voordeel: geen on-demand
 * compilatie per route meer, dus ook merkbaar sneller.
 */
export async function startTestServer(options: { port: number; picnicBaseUrl: string }): Promise<TestServer> {
  const baseURL = `http://127.0.0.1:${options.port}`;
  const nextBin = path.join(process.cwd(), "node_modules", ".bin", "next");
  const buildEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(options.port),
    PICNIC_BASE_URL: options.picnicBaseUrl,
  };

  await runToCompletion(nextBin, ["build"], buildEnv);

  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    nextBin,
    ["start", "-p", String(options.port)],
    {
      cwd: process.cwd(),
      env: buildEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    }
  );

  // De serveruitvoer wordt normaal alleen bewaard om in een opstartfout te
  // kunnen tonen. Met E2E_SERVER_LOG=1 gaat hij ook live mee naar stderr —
  // zonder dat is een falende server action in de e2e onzichtbaar: de test
  // ziet alleen "er verandert niets op de pagina", niet de fout erachter.
  let output = "";
  const record = (chunk: Buffer) => {
    output += chunk.toString();
    if (process.env.E2E_SERVER_LOG) process.stderr.write(chunk);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);

  const exited = new Promise<never>((_, reject) => {
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`Testserver stopte onverwacht (code ${code}):\n${output.slice(-2000)}`));
      }
    });
  });

  await Promise.race([waitForReady(baseURL, Date.now() + READY_TIMEOUT_MS), exited]);

  return {
    baseURL,
    close: () =>
      new Promise<void>((resolve) => {
        const pid = child.pid;
        child.once("exit", () => resolve());
        try {
          if (pid) process.kill(-pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch {
          // Procesgroep bestond al niet meer.
        }
        setTimeout(() => {
          try {
            if (pid) process.kill(-pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {
            // Procesgroep was al gestopt.
          }
          resolve();
        }, 5000);
      }),
  };
}
