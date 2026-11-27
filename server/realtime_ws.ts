import type http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

interface WsHubDeps {
  verifyFirebaseToken: (idToken: string) => Promise<any | null>;
}

interface AuthedSocket extends WebSocket {
  uid?: string;
  isAlive?: boolean;
}

export function attachNexoraWebSocketServer(
  httpServer: http.Server,
  deps: WsHubDeps
): { broadcastToUids: (uids: string[], payload: Record<string, any>) => void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const socketsByUid = new Map<string, Set<AuthedSocket>>();

  function sendJson(ws: WebSocket, payload: Record<string, any>): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {}
    }
  }

  function broadcastToUids(uids: string[], payload: Record<string, any>): void {
    const unique = new Set(uids.filter(Boolean));
    for (const uid of unique) {
      const peers = socketsByUid.get(uid);
      if (!peers) continue;
      for (const sock of peers) {
        sendJson(sock, payload);
      }
    }
  }

  function getOnlineUids(): string[] {
    const out: string[] = [];
    for (const [uid, set] of socketsByUid.entries()) {
      if (set.size > 0) out.push(uid);
    }
    return out;
  }

  function registerUserSocket(ws: AuthedSocket, uid: string): void {
    ws.uid = uid;
    let set = socketsByUid.get(uid);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      socketsByUid.set(uid, set);
    }
    set.add(ws);

    sendJson(ws, {
      type: 'presence:snapshot',
      onlineUids: getOnlineUids(),
    });

    if (wasOffline) {
      for (const peers of socketsByUid.values()) {
        for (const peerSock of peers) {
          if (peerSock.uid !== uid) {
            sendJson(peerSock, { type: 'presence:update', uid, status: 'online' });
          }
        }
      }
    }
  }

  function unregisterUserSocket(ws: AuthedSocket): void {
    const uid = ws.uid;
    if (!uid) return;
    const set = socketsByUid.get(uid);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      socketsByUid.delete(uid);
      for (const peers of socketsByUid.values()) {
        for (const peerSock of peers) {
          sendJson(peerSock, { type: 'presence:update', uid, status: 'offline' });
        }
      }
    }
  }

  httpServer.on('upgrade', async (req, socket, head) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (reqUrl.pathname !== '/ws') {
        return; // Allow Vite/other middleware handlers to handle non-/ws upgrades if applicable
      }

      const token = reqUrl.searchParams.get('token') || '';
      const verified = token ? await deps.verifyFirebaseToken(token) : null;

      wss.handleUpgrade(req, socket, head, (ws) => {
        const authedWs = ws as AuthedSocket;
        authedWs.isAlive = true;
        if (verified?.uid) {
          registerUserSocket(authedWs, verified.uid);
        }
        wss.emit('connection', authedWs, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: AuthedSocket) => {
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (rawData) => {
      let msg: any = null;
      try {
        msg = JSON.parse(String(rawData || '{}'));
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'auth' && typeof msg.token === 'string') {
        const verified = await deps.verifyFirebaseToken(msg.token);
        if (verified?.uid) {
          registerUserSocket(ws, verified.uid);
          sendJson(ws, { type: 'auth:ok', uid: verified.uid });
        } else {
          sendJson(ws, { type: 'auth:error' });
          ws.close(4001, 'Unauthorized');
        }
        return;
      }

      if (!ws.uid) return;

      const recipients = Array.isArray(msg.recipientUids)
        ? msg.recipientUids.map((u: any) => String(u)).filter((u: string) => u && u !== ws.uid).slice(0, 30)
        : [];

      if (msg.type === 'typing:start' || msg.type === 'typing:stop') {
        const threadId = String(msg.threadId || '').slice(0, 128);
        if (!threadId || !recipients.length) return;
        broadcastToUids(recipients, {
          type: msg.type,
          threadId,
          uid: ws.uid,
          atMs: Date.now(),
        });
      } else if (msg.type === 'msg:delivered' || msg.type === 'msg:read') {
        const threadId = String(msg.threadId || '').slice(0, 128);
        const messageId = String(msg.messageId || '').slice(0, 128);
        if (!threadId || !recipients.length) return;
        broadcastToUids(recipients, {
          type: msg.type,
          threadId,
          messageId,
          uid: ws.uid,
          atMs: Date.now(),
        });
      } else if (msg.type === 'dm:notify') {
        const threadId = String(msg.threadId || '').slice(0, 128);
        if (!threadId || !recipients.length) return;
        broadcastToUids(recipients, {
          type: 'dm:notify',
          threadId,
          fromUid: ws.uid,
          atMs: Date.now(),
        });
      }
    });

    ws.on('close', () => {
      unregisterUserSocket(ws);
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const sock = client as AuthedSocket;
      if (sock.isAlive === false) {
        unregisterUserSocket(sock);
        sock.terminate();
        continue;
      }
      sock.isAlive = false;
      try {
        sock.ping();
      } catch {}
    }
  }, 30_000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  return { broadcastToUids };
}
