import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { proxy } from '../hosting/http.ts';
import { websocket } from '../hosting/websocket.ts';
import type { Access } from '../hosting/access.ts';
export function gameViewer(access: Access) {
  const server = createServer();
  websocket(server, { access, configured: () => true, dashboardPort: 6080 });
  const prefix = '/debug-game/';
  return {
    server,
    matches: (url = '') => url.startsWith(prefix),
    strip(req: IncomingMessage) { req.url = req.url!.slice(prefix.length - 1); },
    request(req: IncomingMessage, res: ServerResponse) {
      if (req.url?.startsWith(prefix)) {
        req.url = req.url.slice(prefix.length - 1); proxy(req, res, 6080);
      } else if (req.url?.startsWith('/debug-assets/images/')) {
        req.url = req.url.slice('/debug-assets'.length); proxy(req, res, 8090);
      } else return false;
      return true;
    },
  };
}
