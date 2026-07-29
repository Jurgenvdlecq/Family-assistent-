import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimale lokale vervanging van de echte Picnic-API voor end-to-end tests
 * (Fase 15: "Gebruik mocks voor Picnic in tests. Tests mogen niet
 * afhankelijk zijn van een live Picnic-account.") Dekt precies de paden die
 * `src/lib/picnic/client.ts` gebruikt: zoeken, product toevoegen/
 * verwijderen en mandje legen. Geen echte verificatie van
 * `x-picnic-auth` — dat is aan de echte Picnic-API, niet aan wat we hier
 * testen.
 */
export interface MockPicnicServer {
  url: string;
  addedProducts: { productId: string; count: number }[];
  close(): Promise<void>;
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function searchResponseFor(term: string) {
  return {
    body: {
      child: {
        type: "ROOT",
        children: [
          {
            type: "SELLING_UNIT_TILE",
            sellingUnit: {
              id: `mock-${encodeURIComponent(term)}`,
              name: `Testproduct: ${term}`,
              display_price: 199,
              price: 199,
              unit_quantity: "500 gram",
              image_id: "mock-image",
              max_count: 10,
            },
          },
        ],
      },
    },
  };
}

export async function startMockPicnicServer(): Promise<MockPicnicServer> {
  const addedProducts: { productId: string; count: number }[] = [];

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("x-picnic-auth", "mock-picnic-auth-token");
    res.setHeader("Content-Type", "application/json; charset=UTF-8");

    if (url.pathname === "/pages/search-page-results") {
      const term = url.searchParams.get("search_term") ?? "";
      res.writeHead(200);
      res.end(JSON.stringify(searchResponseFor(term)));
      return;
    }

    if (url.pathname === "/cart/add_product" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as { product_id?: string; count?: number };
      if (body.product_id) {
        addedProducts.push({ productId: body.product_id, count: body.count ?? 1 });
      }
      res.writeHead(200);
      res.end("{}");
      return;
    }

    if (url.pathname === "/cart/remove_product" && req.method === "POST") {
      res.writeHead(200);
      res.end("{}");
      return;
    }

    if (url.pathname === "/cart/clear" && req.method === "POST") {
      addedProducts.length = 0;
      res.writeHead(200);
      res.end("{}");
      return;
    }

    if (url.pathname === "/cart") {
      res.writeHead(200);
      res.end("{}");
      return;
    }

    if (url.pathname === "/user/login" || url.pathname === "/user") {
      res.writeHead(200);
      res.end("{}");
      return;
    }

    res.writeHead(200);
    res.end("{}");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    addedProducts,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
