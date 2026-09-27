// Minimal static file serving shared by the dev server and the browser screenshot tool.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Resolves a URL path inside root (null when it escapes root or does not exist as a file). */
export function fileInRoot(root: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]!);
  } catch {
    return null;
  }
  const base = resolve(root);
  const file = resolve(join(base, normalize(rel)));
  if (file !== base && !file.startsWith(base + sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

export function sendFile(res: ServerResponse, file: string): void {
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

export function send(res: ServerResponse, status: number, body: string | Uint8Array, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Listens on `port` (0 = any free port), trying the next ports when it is taken. */
export function listen(server: Server, port: number, host: string, tries = 20): Promise<number> {
  return new Promise((resolvePort, reject) => {
    let attempt = 0;
    const tryPort = (p: number) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (e.code === 'EADDRINUSE' && port !== 0 && ++attempt < tries) tryPort(p + 1);
        else reject(e);
      };
      const onListening = () => {
        server.off('error', onError);
        resolvePort((server.address() as AddressInfo).port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, host);
    };
    tryPort(port);
  });
}

export interface StaticServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Serves a directory (index.html for '/'). Used by `pnpm shot:browser` for the temp web build. */
export async function serveDir(dir: string, port = 0, host = '127.0.0.1'): Promise<StaticServer> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/favicon.ico') return send(res, 204, '');
    const file = fileInRoot(dir, path === '/' ? '/index.html' : path);
    if (!file) return send(res, 404, `not found: ${path}`);
    sendFile(res, file);
  });
  const p = await listen(server, port, host);
  return {
    url: `http://${host}:${p}`,
    port: p,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
