import type { FastifyInstance, FastifyReply } from "fastify";
import { WebSocket, type RawData } from "ws";
import {
  SessionDaemonClient,
  type SessionDaemonRequestOptions,
} from "../../sessiond/sessionDaemonClient.js";

export interface SessionProxyDaemon {
  request(
    method: string,
    path: string,
    body?: unknown,
    options?: SessionDaemonRequestOptions,
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
  connectWebSocket(path: string): WebSocket;
}

export function registerSessionProxyRoutes(app: FastifyInstance, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api"): void {
  const proxy = async (request: { method: string; url: string; body?: unknown }, reply: FastifyReply) => {
    try {
      const upstream = await daemon.request(request.method, stripPrefix(request.url, prefix), request.body);
      reply.code(upstream.statusCode);
      const contentType = upstream.headers["content-type"];
      if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
      return upstream.body !== "" ? parseJson(upstream.body) : undefined;
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  };

  app.get(`${prefix}/sessiond/health`, (_request, reply) => proxy({ method: "GET", url: `${prefix}/health` }, reply));
  app.get(`${prefix}/sessiond/runtime`, (_request, reply) => proxy({ method: "GET", url: `${prefix}/runtime` }, reply));

  app.get<{ Params: { sessionId: string } }>(`${prefix}/sessions/:sessionId/events`, { websocket: true }, (socket, request) => {
    bridgeSockets(socket, daemon.connectWebSocket(stripPrefix(request.url, prefix)));
  });

  app.get(`${prefix}/sessions/events`, { websocket: true }, (socket) => {
    bridgeSockets(socket, daemon.connectWebSocket("/sessions/events"));
  });

  app.get(`${prefix}/events`, { websocket: true }, (socket) => {
    bridgeSockets(socket, daemon.connectWebSocket("/events"));
  });

  app.all(`${prefix}/status`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/notices`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/notices/dismiss`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/auth`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/auth/*`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions`, (request, reply) => proxy(request, reply));
  // History images: the daemon answers with JSON `{ mimeType, data }`; serve the
  // decoded bytes so the browser can lazy-load and cache them. The image id
  // embeds a content hash, so a URL never changes meaning.
  app.get(`${prefix}/sessions/:sessionId/images/:imageId`, async (request, reply) => {
    try {
      const upstream = await daemon.request("GET", stripPrefix(request.url, prefix));
      const image = upstream.statusCode === 200 ? historyImage(parseJson(upstream.body)) : undefined;
      if (image === undefined) return await reply.code(upstream.statusCode === 200 ? 502 : upstream.statusCode).send(upstream.body === "" ? undefined : parseJson(upstream.body));
      return await reply
        .header("content-type", image.mimeType)
        .header("cache-control", "private, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff")
        .send(Buffer.from(image.data, "base64"));
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });
  app.all(`${prefix}/sessions/*`, (request, reply) => proxy(request, reply));
}

function historyImage(value: unknown): { mimeType: string; data: string } | undefined {
  if (typeof value !== "object" || value === null || !("mimeType" in value) || !("data" in value)) return undefined;
  const { mimeType, data } = value;
  return typeof mimeType === "string" && mimeType.startsWith("image/") && typeof data === "string" ? { mimeType, data } : undefined;
}

function stripPrefix(url: string, prefix: string): string {
  const path = url.split("?", 1)[0] ?? url;
  const query = url.slice(path.length);
  const stripped = path.startsWith(prefix) ? `${path.slice(prefix.length)}${query}` : url;
  return stripped === "" ? "/" : stripped;
}

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function requestFailed(reply: FastifyReply, error: unknown): void {
  reply.code(502).send({ error: `Session daemon unavailable: ${error instanceof Error ? error.message : String(error)}` });
}

function bridgeSockets(client: WebSocket, upstream: WebSocket): void {
  client.on("message", (data) => { sendIfOpen(upstream, data); });
  upstream.on("message", (data) => { sendIfOpen(client, data); });
  client.on("close", () => { upstream.close(); });
  upstream.on("close", () => { client.close(); });
  upstream.on("error", () => { client.close(); });
  client.on("error", () => { upstream.close(); });
}

function sendIfOpen(socket: WebSocket, data: RawData): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  }
}
