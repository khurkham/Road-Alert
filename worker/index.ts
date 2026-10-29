interface Env { VEHICLES: DurableObjectNamespace; }
type Vehicle = { id: string; lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; updatedAt: number };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "same-origin" } });
function cors(request: Request) {
  const headers = new Headers({ "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" });
  const origin = request.headers.get("Origin");
  if (origin && origin === new URL(request.url).origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    if (url.pathname === "/api/health") return json({ ok: true, service: "road-alert-api", timestamp: Date.now() });
    const idMatch = url.pathname.match(/^\/api\/vehicles\/([A-Za-z0-9-]{20,50})$/);
    if (url.pathname === "/api/vehicles" && request.method === "GET") {
      const stub = env.VEHICLES.get(env.VEHICLES.idFromName("live-vehicles"));
      return stub.fetch("https://vehicles.internal/list");
    }
    if (idMatch && ["PUT", "DELETE"].includes(request.method)) {
      const id = idMatch[1];
      const stub = env.VEHICLES.get(env.VEHICLES.idFromName("live-vehicles"));
      if (request.method === "DELETE") return stub.fetch("https://vehicles.internal/vehicle/" + id, { method: "DELETE" });
      let body: Omit<Vehicle, "id">;
      try { body = await request.json() as Omit<Vehicle, "id">; } catch { return json({ error: "invalid_json" }, 400); }
      if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng) || Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180 || !Number.isFinite(body.accuracy) || body.accuracy < 0) return json({ error: "invalid_location" }, 400);
      const record: Vehicle = { id, lat: body.lat, lng: body.lng, accuracy: body.accuracy, speed: Number.isFinite(body.speed) ? body.speed : null, heading: Number.isFinite(body.heading) ? body.heading : null, updatedAt: Date.now() };
      return stub.fetch("https://vehicles.internal/vehicle/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record) });
    }
    return json({ error: "not_found" }, 404);
  }
};
export class VehicleRegistry {
  state: DurableObjectState;
  constructor(state: DurableObjectState) { this.state = state; }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = url.pathname.split("/").pop() || "";
    if (url.pathname === "/list" && request.method === "GET") {
      const stored = await this.state.storage.list<Vehicle>({ prefix: "v:" });
      const now = Date.now();
      const vehicles: Vehicle[] = [];
      for (const [k, v] of stored) {
        if (now - v.updatedAt > 120000) await this.state.storage.delete(k);
        else vehicles.push(v);
      }
      return json({ vehicles });
    }
    if (url.pathname.startsWith("/vehicle/")) {
      if (request.method === "DELETE") { await this.state.storage.delete("v:" + key); return json({ ok: true }); }
      if (request.method === "PUT") {
        const v = await request.json() as Vehicle;
        await this.state.storage.put("v:" + key, v);
        await this.state.storage.setAlarm(Date.now() + 120000);
        return json({ ok: true, expiresInSeconds: 120 });
      }
    }
    return json({ error: "not_found" }, 404);
  }
  async alarm() {
    const stored = await this.state.storage.list<Vehicle>({ prefix: "v:" });
    const now = Date.now();
    let nextExpiry = Infinity;
    for (const [key, value] of stored) {
      const expiry = value.updatedAt + 120000;
      if (expiry <= now) await this.state.storage.delete(key);
      else nextExpiry = Math.min(nextExpiry, expiry);
    }
    if (nextExpiry !== Infinity) await this.state.storage.setAlarm(nextExpiry);
  }
}