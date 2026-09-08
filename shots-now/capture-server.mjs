/**
 * Use instead of `npm run dev` for a long README capture. Reuses port 1420
 * exclusively and disables HMR so unrelated file writes cannot reset the
 * recording's browser state. Ordinary development still uses `npm run dev`.
 */
import { createServer } from 'vite';

const server = await createServer({
  server: { host: '127.0.0.1', port: 1420, strictPort: true, hmr: false },
});
await server.listen();
server.printUrls();
