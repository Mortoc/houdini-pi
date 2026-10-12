import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

export const LOOPBACK = "127.0.0.1";

export interface ServerOptions {
  host: string;
  port: number;
  token: string;
  staticDir: string | undefined;
  /** Conversation assets (COP previews, viewport shots), served at /session-assets/<session>/<file> with the token. (/assets/ is the ui bundle.) */
  assetsDir?: string;
  onConnection: (socket: WebSocket) => void;
  health?: () => Record<string, unknown>;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function tokenOf(url: string | undefined, host: string | undefined): string | null {
  return new URL(url ?? "/", `http://${host ?? LOOPBACK}`).searchParams.get("token");
}

export function startServer(options: ServerOptions): Promise<RunningServer> {
  if (options.host !== LOOPBACK) {
    throw new Error(`refusing to bind ${options.host}: the sidecar serves ${LOOPBACK} only`);
  }
  const server = createServer((request, response) => handleHttp(request, response, options));
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const token_matches = tokenOf(request.url, request.headers.host) === options.token;
    if (!token_matches) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => options.onConnection(ws));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({ port, close: () => closeAll(server, wss) });
    });
  });
}

function closeAll(server: Server, wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) client.terminate();
  return new Promise((resolve) => {
    wss.close(() => server.close(() => resolve()));
  });
}

function handleHttp(request: IncomingMessage, response: ServerResponse, options: ServerOptions) {
  const url = new URL(request.url ?? "/", `http://${LOOPBACK}`);
  if (url.pathname === "/health") {
    const body = JSON.stringify({ ok: true, pid: process.pid, ...(options.health?.() ?? {}) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(body);
    return;
  }
  if (url.pathname.startsWith("/session-assets/")) {
    const token_matches = url.searchParams.get("token") === options.token;
    if (!token_matches) {
      response.writeHead(401);
      response.end("token");
      return;
    }
    if (options.assetsDir === undefined) {
      response.writeHead(404);
      response.end("no assets dir");
      return;
    }
    serveStatic(decodeURIComponent(url.pathname.slice("/session-assets".length)), options.assetsDir, response);
    return;
  }
  if (options.staticDir === undefined) {
    response.writeHead(404);
    response.end("no static dir");
    return;
  }
  serveStatic(url.pathname, options.staticDir, response);
}

function serveStatic(pathname: string, dir: string, response: ServerResponse) {
  const relative = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(dir, relative);
  const inside_dir = file.startsWith(dir);
  if (!inside_dir) {
    response.writeHead(403);
    response.end();
    return;
  }
  let size: number;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error("not a file");
    size = stats.size;
  } catch {
    response.writeHead(404);
    response.end("not found");
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "content-length": size,
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(response);
}
