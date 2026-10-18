import { requestObject, requestText, type HttpRequest, type HttpResponse } from "../http/contracts.ts";

// Trade reports for ALNinja (POST /api/v1/observations). Characters collect what they see and send
// each report here; the coordinator holds the credentials and forwards the report unchanged.
// Credentials: a reporting key the merchant mails to ALNinja's key-mail character (registered to the
// merchant, so reports send "<merchant>:<key>"), or an instance's admin REPORT_TOKEN. Neither is
// returned in the public state.
export interface AlninjaSettings {
  enabled: boolean;
  token: string;
  key: string;
  keyOwner: string | null;
}
interface AlninjaState {
  alninja: AlninjaSettings;
  alninjaReporting: boolean;
}
interface AlninjaPorts {
  randomKey(): string;
  merchant(): string | null;
  /** https://alninja.trade; journeys point it at a local stand-in. */
  baseUrl(): string;
  known(name: string): boolean;
  fetch(url: string, options: RequestInit): Promise<Response>;
  timeout(milliseconds: number): AbortSignal;
  now(): number;
  persist(): void;
}
interface LastReport {
  at: number;
  reporter: string;
  ok: boolean;
  stored?: number;
  error?: string;
}

const requestTimeoutMs = 15_000;
const priceLifetimeMs = 60_000;
const regions = ["ALL", "US", "EU", "ASIA"];
// ALNinja accepts 12 reports a minute per key; the admin token is not limited.
const keyReportsPerMinute = 11;

export function initialAlninja(saved: unknown): AlninjaSettings {
  const value = requestObject(saved);
  return { enabled: value.enabled === true, token: requestText(value.token), key: requestText(value.key),
    keyOwner: requestText(value.keyOwner) || null };
}

const credential = (settings: AlninjaSettings) =>
  settings.token || (settings.key && settings.keyOwner ? `${settings.keyOwner}:${settings.key}` : "");
const reporting = (settings: AlninjaSettings) => settings.enabled && !!credential(settings);

export function createAlninja(state: AlninjaState, ports: AlninjaPorts) {
  state.alninjaReporting = reporting(state.alninja);
  const reporters: Record<string, LastReport> = {};
  const prices = new Map<string, { at: number; value: Promise<unknown> }>();
  let keyReports: number[] = [];

  function snapshot() {
    const { enabled, token, key, keyOwner } = state.alninja;
    return { enabled, hasToken: !!token, hasKey: !!key, keyOwner, reporting: state.alninjaReporting, reporters };
  }
  function settings(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), next = { ...state.alninja };
    if (body.token !== undefined) {
      const token = requestText(body.token).trim();
      if (token.length > 500 || /\s/.test(token)) return res.status(400).json({ error: "token: up to 500 characters, no spaces" });
      next.token = token;
    }
    if (body.enabled !== undefined) next.enabled = body.enabled === true;
    update(next);
    return res.json(snapshot());
  }
  async function forward(reporter: string, report: Record<string, unknown>) {
    const response = await ports.fetch(ports.baseUrl() + "/api/v1/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + credential(state.alninja) },
      body: JSON.stringify({ ...report, reporter }),
      signal: ports.timeout(requestTimeoutMs),
    });
    const result = requestObject(await response.json().catch(() => ({})));
    reporters[reporter] = response.ok
      ? { at: ports.now(), reporter, ok: true, stored: Number(result.stored) || 0 }
      : { at: ports.now(), reporter, ok: false, error: requestText(result.error) || "HTTP " + response.status };
    return response.ok;
  }
  /** A character's report. `accepted` tells it whether to drop its batch or keep it for a retry. */
  async function report(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const body = requestObject(req.body), reporter = requestText(body.reporter);
    if (!ports.known(reporter)) return res.status(400).json({ error: "unknown character" });
    if (!state.alninjaReporting) return res.json({ accepted: false, reporting: false });
    if (!state.alninja.token) {
      keyReports = keyReports.filter((at) => ports.now() - at < 60_000);
      // Over the key's budget the character keeps its batch and retries, merging trades into one report.
      if (keyReports.length >= keyReportsPerMinute) return res.json({ accepted: false, reporting: true, throttled: true });
      keyReports.push(ports.now());
    }
    try {
      return res.json({ accepted: await forward(reporter, body), reporting: true });
    } catch (error) {
      reporters[reporter] = { at: ports.now(), reporter, ok: false, error: error instanceof Error ? error.message : String(error) };
      return res.json({ accepted: false, reporting: true });
    }
  }
  /** Current ALNinja prices for one item (every level and variant), from its public API. Prices
   * need no token, so lookups work before reporting is set up. */
  async function price(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const query = requestObject(req.query), item = requestText(query.item);
    const region = regions.includes(requestText(query.region)) ? requestText(query.region) : "ALL";
    if (!/^[A-Za-z0-9_]{1,64}$/.test(item)) return res.status(400).json({ error: "item: an item id" });
    const base = ports.baseUrl(), key = `${base}\u0000${region}\u0000${item}`;
    let cached = prices.get(key);
    if (!cached || ports.now() - cached.at > priceLifetimeMs) {
      const value = ports.fetch(`${base}/api/v1/prices/${encodeURIComponent(item)}?region=${region}`,
        { signal: ports.timeout(requestTimeoutMs) }).then(async (response) => {
        if (!response.ok) throw new Error("ALNinja returned HTTP " + response.status);
        return response.json();
      });
      cached = { at: ports.now(), value };
      if (prices.size > 500) prices.clear();
      prices.set(key, cached);
      value.catch(() => prices.delete(key));
    }
    try {
      return res.json({ source: base, ...requestObject(await cached.value) });
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  function update(next: AlninjaSettings) {
    state.alninja = next;
    state.alninjaReporting = reporting(next);
    ports.persist();
  }
  /** A new reporting key; it reports only once ALNinja confirms the mailed key. */
  function generateKey(_req: HttpRequest, res: HttpResponse): unknown {
    update({ ...state.alninja, key: ports.randomKey(), keyOwner: null });
    return res.json({ key: state.alninja.key });
  }
  function revealKey(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json({ key: state.alninja.key });
  }
  async function getJson(path: string, authorization?: string) {
    const response = await ports.fetch(ports.baseUrl() + path, {
      headers: authorization ? { Authorization: "Bearer " + authorization } : {},
      signal: ports.timeout(requestTimeoutMs),
    });
    if (!response.ok) throw new Error("ALNinja returned HTTP " + response.status);
    return requestObject(await response.json());
  }
  /** Where to mail the key, and whether ALNinja has registered it for the merchant. */
  async function auth(_req: HttpRequest, res: HttpResponse): Promise<unknown> {
    try {
      const instructions = await getJson("/api/v1/auth");
      const merchant = ports.merchant(), key = state.alninja.key;
      const status = merchant && key ? await getJson("/api/v1/auth/" + encodeURIComponent(merchant), `${merchant}:${key}`) : {};
      const valid = status.valid === true;
      if (valid && state.alninja.keyOwner !== merchant) update({ ...state.alninja, keyOwner: merchant });
      return res.json({ enabled: instructions.enabled === true, mailTo: requestText(instructions.mailTo) || null,
        subject: requestText(instructions.subject) || "alninja_auth", merchant, registered: status.registered === true, valid,
        keyOwner: state.alninja.keyOwner });
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { snapshot, settings, report, price, generateKey, revealKey, auth };
}
