import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { roleHasPermission, type HomeRole, type Permission, type RealtimeClientMessage, type RealtimeEvent } from '@smartnest/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { resolveSession } from '../middleware/auth.js';
import { bus } from '../services/bus.js';

interface Client {
  ws: WebSocket;
  userId: string;
  sessionId: string;
  homeId: string | null;
  role: HomeRole | null;
  alive: boolean;
}

/** Permission a subscriber needs to receive each event type. */
const EVENT_PERMISSION: Record<RealtimeEvent['type'], Permission> = {
  'device.updated': 'devices.view',
  'device.removed': 'devices.view',
  'command.updated': 'devices.view',
  'integration.updated': 'integrations.view',
  'activity.created': 'activity.view',
  'notification.created': 'home.view',
  'scene.execution': 'scenes.activate',
  'automation.execution': 'automations.view',
  'camera.viewers': 'cameras.view',
  'home.changed': 'home.view',
};

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Authenticated WebSocket channel at /api/ws.
 * - Upgrade requires a valid session cookie and an allowed Origin (prevents cross-site WebSocket hijacking).
 * - Clients subscribe to one home; membership is verified and re-verified periodically.
 * - Every event is filtered by the subscriber's role permissions.
 */
export class RealtimeHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  private clients = new Set<Client>();
  private timer: NodeJS.Timeout | null = null;
  private readonly onBusEvent = (event: RealtimeEvent, opts?: { userId?: string }) => this.broadcast(event, opts);

  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => void this.handleUpgrade(req, socket, head));
    bus.on('realtime', this.onBusEvent);
    this.timer = setInterval(() => void this.revalidate(), 30_000);
    this.timer.unref?.();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    bus.off('realtime', this.onBusEvent);
    for (const c of this.clients) c.ws.terminate();
    this.clients.clear();
    this.wss.close();
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/ws') return;
    const reject = (code: number, msg: string) => {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const origin = req.headers.origin;
    const host = req.headers.host;
    const sameHost = origin && host && new URL(origin).host === host;
    if (origin && !sameHost && !config.webOrigins.includes(origin)) return reject(403, 'Forbidden');
    const session = await resolveSession(parseCookies(req.headers.cookie)[config.sessionCookie]).catch(() => null);
    if (!session) return reject(401, 'Unauthorized');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, session.userId, session.id));
  }

  private onConnection(ws: WebSocket, userId: string, sessionId: string): void {
    const client: Client = { ws, userId, sessionId, homeId: null, role: null, alive: true };
    this.clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', () => this.clients.delete(client));
    ws.on('message', (raw) => {
      let msg: RealtimeClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      if (msg.type === 'subscribe' && typeof msg.homeId === 'string') void this.subscribe(client, msg.homeId);
    });
    ws.send(JSON.stringify({ type: 'ready' }));
  }

  private async subscribe(client: Client, homeId: string): Promise<void> {
    const m = await prisma.homeMembership.findUnique({ where: { homeId_userId: { homeId, userId: client.userId } } });
    if (!m) {
      client.ws.send(JSON.stringify({ type: 'error', message: 'Not a member of that home.' }));
      return;
    }
    client.homeId = homeId;
    client.role = m.role as HomeRole;
    client.ws.send(JSON.stringify({ type: 'subscribed', homeId }));
  }

  private broadcast(event: RealtimeEvent, opts?: { userId?: string }): void {
    if (event.type === 'home.changed') void this.refreshRoles(event.homeId);
    const payload = JSON.stringify(event);
    for (const c of this.clients) {
      if (c.homeId !== event.homeId || !c.role) continue;
      if (opts?.userId && opts.userId !== c.userId) continue;
      if (!roleHasPermission(c.role, EVENT_PERMISSION[event.type])) continue;
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
    }
  }

  private async refreshRoles(homeId: string): Promise<void> {
    const subs = [...this.clients].filter((c) => c.homeId === homeId);
    if (!subs.length) return;
    const members = await prisma.homeMembership.findMany({ where: { homeId } });
    const roles = new Map(members.map((m) => [m.userId, m.role as HomeRole]));
    for (const c of subs) {
      const role = roles.get(c.userId);
      if (!role) {
        c.ws.close(4403, 'Membership revoked');
        this.clients.delete(c);
      } else c.role = role;
    }
  }

  /** Close sockets whose session expired/was revoked, and ping to detect dead peers. */
  private async revalidate(): Promise<void> {
    const sessionIds = [...new Set([...this.clients].map((c) => c.sessionId))];
    if (!sessionIds.length) return;
    const valid = new Set(
      (await prisma.session.findMany({ where: { id: { in: sessionIds }, expiresAt: { gt: new Date() } }, select: { id: true } }).catch(() => [])).map((s) => s.id),
    );
    for (const c of [...this.clients]) {
      if (!valid.has(c.sessionId)) {
        c.ws.close(4401, 'Session ended');
        this.clients.delete(c);
        continue;
      }
      if (!c.alive) {
        c.ws.terminate();
        this.clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
    const homes = new Set([...this.clients].map((c) => c.homeId).filter((h): h is string => !!h));
    for (const h of homes) await this.refreshRoles(h).catch((e) => logger.warn({ err: (e as Error).message }, 'role refresh failed'));
  }
}
