import { RealtimeClient } from '@supabase/realtime-js';
import type { LinkCloud } from './linkCloud';

export async function notificationTopic(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return (
    'owol:' + Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
  );
}

/** Broadcasts carry no plan, personal information or access token. Treat every
 * event as an untrusted hint; only the capability-protected RPC supplies data. */
export function subscribePlanChanges(cloud: LinkCloud, token: string, onChange: () => void) {
  let disposed = false;
  let client: RealtimeClient | undefined;
  let lastHint = 0;
  const refresh = () => {
    if (disposed || Date.now() - lastHint < 300) return;
    lastHint = Date.now();
    onChange();
  };
  void notificationTopic(token)
    .then((topic) => {
      if (disposed) return;
      client = new RealtimeClient(cloud.config.url.replace(/^https:/, 'wss:') + '/realtime/v1', {
        params: { apikey: cloud.config.key },
      });
      client
        .channel(topic, { config: { private: false } })
        .on('broadcast', { event: 'changed' }, refresh)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') refresh();
        });
    })
    .catch(() => {
      // The sync engine's periodic refresh remains available when WebSockets fail.
    });
  return () => {
    disposed = true;
    if (client) {
      void client.removeAllChannels();
      client.disconnect();
    }
  };
}
