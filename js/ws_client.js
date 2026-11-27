/**
 * Authenticated WebSocket client for Nexora real-time presence, typing indicators,
 * and message delivery/read acknowledgements.
 */
export function createNexoraWsClient({ getToken, onEvent }) {
  let ws = null;
  let closedByCaller = false;
  let reconnectTimer = null;
  let backoffMs = 1200;

  async function connect() {
    if (closedByCaller || typeof WebSocket === 'undefined') return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let token = '';
    try {
      token = await getToken();
    } catch {}
    if (!token) {
      scheduleReconnect();
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      backoffMs = 1200;
    });

    ws.addEventListener('message', (ev) => {
      try {
        const data = JSON.parse(String(ev.data || '{}'));
        if (typeof onEvent === 'function' && data?.type) {
          onEvent(data);
        }
      } catch {}
    });

    ws.addEventListener('close', () => {
      ws = null;
      if (!closedByCaller) {
        scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      // Handled by close reconnect loop
    });
  }

  function scheduleReconnect() {
    if (closedByCaller || reconnectTimer) return;
    const delay = Math.min(20_000, backoffMs);
    backoffMs = Math.min(20_000, Math.round(backoffMs * 1.7));
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function disconnect() {
    closedByCaller = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.close(1000, 'Sign out');
      } catch {}
      ws = null;
    }
  }

  return {
    connect,
    send,
    disconnect,
  };
}
