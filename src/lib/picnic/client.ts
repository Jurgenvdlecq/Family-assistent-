import { createHash } from "node:crypto";
import { extractSearchResults, type PicnicSearchResultItem } from "./searchResults";
import { logEvent } from "@/lib/logger";

// TypeScript-poort van de niet-officiële python-picnic-api2 (Apache-2.0) —
// dezelfde endpoints, headers en inlogflow, rechtstreeks overgenomen uit de
// broncode van die library. Geen officiële, gedocumenteerde Picnic-API (zie
// risico R1 in het technisch ontwerpdocument); dit kan zonder aankondiging
// stoppen met werken als Picnic iets aan hun app-protocol wijzigt.

// PICNIC_BASE_URL is alleen bedoeld voor end-to-end tests (zie e2e/fixtures/
// mockPicnicServer.ts): daar draait geen live Picnic-account tegenaan, dus
// wordt de echte URL vervangen door een lokale mock. In elke andere omgeving
// is de variabele niet gezet en gebruiken we gewoon de echte Picnic-API.
const BASE_URL = process.env.PICNIC_BASE_URL ?? "https://storefront-prod.nl.picnicinternational.com/api/15";
const AUTH_HEADER = "x-picnic-auth";
const PICNIC_HEADERS = {
  "x-picnic-agent": "30100;1.206.1-#15408",
  "x-picnic-did": "598F770380CA54B6",
};

export class PicnicAuthError extends Error {}
export class Picnic2FARequiredError extends Error {}
export class Picnic2FAError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** Netwerk/verbindingsfout (geen respons van Picnic ontvangen) — anders dan een fout die Picnic zelf teruggeeft. */
export class PicnicNetworkError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/** Overige fouten die Picnic als JSON teruggeeft (bv. product niet leverbaar, mandje-fout) — geen auth-probleem. */
export class PicnicApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

interface PicnicErrorBody {
  error?: { code?: string; message?: string };
  second_factor_authentication_required?: boolean;
}

export class PicnicClient {
  private authToken?: string;

  constructor(authToken?: string) {
    this.authToken = authToken;
  }

  getAuthToken(): string | undefined {
    return this.authToken;
  }

  isAuthenticated(): boolean {
    return Boolean(this.authToken);
  }

  private updateTokenFromResponse(res: Response) {
    const token = res.headers.get(AUTH_HEADER);
    if (token && token !== this.authToken) {
      this.authToken = token;
    }
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "User-Agent": "okhttp/4.9.0",
      "Content-Type": "application/json; charset=UTF-8",
      ...extraHeaders,
    };
    if (this.authToken) headers[AUTH_HEADER] = this.authToken;

    let res: Response;
    try {
      res = await fetch(BASE_URL + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      logEvent({
        level: "error",
        area: "picnic_network",
        message: "Geen verbinding met Picnic",
        meta: { method, path },
      });
      throw new PicnicNetworkError("Geen verbinding met Picnic — probeer het later opnieuw.", cause);
    }
    this.updateTokenFromResponse(res);
    return res;
  }

  private async requestJson(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ) {
    const res = await this.request(method, path, body, extraHeaders);
    const data = (await res.json().catch(() => ({}))) as PicnicErrorBody;
    if (data?.error?.code === "AUTH_ERROR" || data?.error?.code === "AUTH_INVALID_CRED") {
      logEvent({
        level: "warn",
        area: "picnic_auth",
        message: "Picnic-sessie verlopen of ongeldig",
        meta: { method, path, code: data.error.code },
      });
      throw new PicnicAuthError(data.error.message ?? "Picnic-authenticatiefout");
    }
    if (data?.error?.code) {
      logEvent({
        level: "warn",
        area: "picnic_api",
        message: data.error.message ?? "Onbekende fout van Picnic",
        meta: { method, path, code: data.error.code },
      });
      throw new PicnicApiError(data.error.message ?? "Onbekende fout van Picnic", data.error.code);
    }
    return data;
  }

  /** MD5(wachtwoord) + inloggen — exact zoals de officiële Picnic-app. */
  async login(username: string, password: string) {
    const secret = createHash("md5").update(password, "utf8").digest("hex");
    const data = await this.requestJson(
      "POST",
      "/user/login",
      { key: username, secret, client_id: 30100 },
      PICNIC_HEADERS
    );
    if (data.second_factor_authentication_required === true) {
      throw new Picnic2FARequiredError(
        data.error?.message ?? "Tweestapsverificatie vereist"
      );
    }
    return data;
  }

  async generate2FACode(channel: "SMS" | "EMAIL" = "SMS") {
    const res = await this.request("POST", "/user/2fa/generate", { channel }, PICNIC_HEADERS);
    await this.throwOn2FAError(res);
  }

  async verify2FACode(code: string) {
    const res = await this.request("POST", "/user/2fa/verify", { otp: code }, PICNIC_HEADERS);
    await this.throwOn2FAError(res);
  }

  private async throwOn2FAError(res: Response) {
    if (res.status === 204) return;
    const data = (await res.json().catch(() => null)) as PicnicErrorBody | null;
    if (data?.error?.code) {
      throw new Picnic2FAError(data.error.message ?? "Tweestapsverificatie mislukt", data.error.code);
    }
  }

  async getUser() {
    return this.requestJson("GET", "/user");
  }

  async search(term: string): Promise<PicnicSearchResultItem[]> {
    const data = await this.requestJson(
      "GET",
      `/pages/search-page-results?search_term=${encodeURIComponent(term)}`,
      undefined,
      PICNIC_HEADERS
    );
    return extractSearchResults(data);
  }

  async addProduct(productId: string, count = 1) {
    return this.requestJson("POST", "/cart/add_product", { product_id: productId, count });
  }

  async removeProduct(productId: string, count = 1) {
    return this.requestJson("POST", "/cart/remove_product", { product_id: productId, count });
  }

  async getCart() {
    return this.requestJson("GET", "/cart");
  }

  async clearCart() {
    return this.requestJson("POST", "/cart/clear");
  }
}
