const WORKER_ORIGIN = "https://road-alert-api.YOUR-SUBDOMAIN.workers.dev";
export async function onRequest(context: { request: Request }) {
  const incoming = new URL(context.request.url);
  const upstream = new URL(incoming.pathname + incoming.search, WORKER_ORIGIN);
  return fetch(new Request(upstream.toString(), context.request));
}