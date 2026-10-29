interface Env {
  VEHICLES: DurableObjectNamespace;
}
type Vehicle = { id: string; lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; updatedAt: number };
const MAX_AGE_MS = 120_000;
const ALLOWED_ORIGINS = new Set(["https://road-alert-dg4.pages.dev", "https://road-alert-api.bejaitai.workers.dev"]);

function json(data: unknown, status = 200, headers?: HeadersInit) {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers: h });
}
function addCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function validBody(value: unknown): value is Omit<Vehicle, "id" | "updatedAt"> {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return Number.isFinite(b.lat) && Number.isFinite(b.lng) &&
    Math.abs(b.lat as number) <= 90 && Math.abs(b.lng as number) <= 180 &&
    Number.isFinite(b.accuracy) && (b.accuracy as number) >= 0 && (b.accuracy as number) <= 100_000 &&
    (b.speed == null || (Number.isFinite(b.speed) && (b.speed as number) >= 0)) &&
    (b.heading == null || (Number.isFinite(b.heading) && (b.heading as number) >= 0 && (b.heading as number) < 360));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "origin_not_allowed" }, 403);
      return addCors(request, new Response(null, { status: 204 }));
    }
    if (origin && !ALLOWED_ORIGINS.has(origin)) return addCors(request, json({ error: "origin_not_allowed" }, 403));
    if (url.pathname === "/api/health" && request.method === "GET") {
      return addCors(request, json({ ok: true, service: "road-alert-api", timestamp: Date.now() }));
    }
    if (url.pathname === "/api/vehicles" && request.method === "GET") {
      const stub = env.VEHICLES.get(env.VEHICLES.idFromName("live-vehicles"));
      return addCors(request, await stub.fetch("https://vehicles.internal/list"));
    }
    const match = url.pathname.match(/^\/api\/vehicles\/([A-Za-z0-9-]{20,50})$/);
    if (match && request.method === "DELETE") {
      const stub = env.VEHICLES.get(env.VEHICLES.idFromName("live-vehicles"));
      return addCors(request, await stub.fetch("https://vehicles.internal/vehicle/" + match[1], { method: "DELETE" }));
    }
    if (match && request.method === "PUT") {
      let body: unknown;
      try { body = await request.json(); } catch { return addCors(request, json({ error: "invalid_json" }, 400)); }
      if (!validBody(body)) return addCors(request, json({ error: "invalid_location" }, 400));
      const record: Vehicle = {
        id: match[1], lat: body.lat, lng: body.lng, accuracy: body.accuracy,
        speed: body.speed ?? null, heading: body.heading ?? null, updatedAt: Date.now()
      };
      const stub = env.VEHICLES.get(env.VEHICLES.idFromName("live-vehicles"));
      return addCors(request, await stub.fetch("https://vehicles.internal/vehicle/" + match[1], {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record)
      }));
    }
    if (url.pathname === "/api/vehicles" || url.pathname.startsWith("/api/vehicles/")) {
      return addCors(request, json({ error: "method_not_allowed" }, 405, { Allow: "GET, PUT, DELETE, OPTIONS" }));
    }
    return addCors(request, json({ error: "not_found" }, 404));
  }
};

export class VehicleRegistry {
  constructor(private readonly state: DurableObjectState) {}
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = url.pathname.split("/").pop() || "";
    if (url.pathname === "/list" && request.method === "GET") {
      const stored = await this.state.storage.list<Vehicle>({ prefix: "v:" });
      const now = Date.now();
      const vehicles: Vehicle[] = [];
      for (const [storageKey, value] of stored) {
        if (now - value.updatedAt > MAX_AGE_MS) await this.state.storage.delete(storageKey);
        else vehicles.push(value);
      }
      return json({ vehicles });
    }
    if (url.pathname.startsWith("/vehicle/") && request.method === "DELETE") {
      await this.state.storage.delete("v:" + key);
      return json({ ok: true });
    }
    if (url.pathname.startsWith("/vehicle/") && request.method === "PUT") {
      const value = await request.json() as Vehicle;
      await this.state.storage.put("v:" + key, value);
      await this.state.storage.setAlarm(Date.now() + MAX_AGE_MS);
      return json({ ok: true, expiresInSeconds: MAX_AGE_MS / 1000 });
    }
    return json({ error: "not_found" }, 404);
  }
  async alarm(): Promise<void> {
    const stored = await this.state.storage.list<Vehicle>({ prefix: "v:" });
    const now = Date.now();
    let nextExpiry = Infinity;
    for (const [key, value] of stored) {
      const expiry = value.updatedAt + MAX_AGE_MS;
      if (expiry <= now) await this.state.storage.delete(key);
      else nextExpiry = Math.min(nextExpiry, expiry);
    }
    if (nextExpiry !== Infinity) await this.state.storage.setAlarm(nextExpiry);
  }
}
