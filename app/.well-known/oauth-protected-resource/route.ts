import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler';
import { isLocalAuthMode } from '@/lib/auth';
import { authIssuer } from '@/lib/server/mcp/auth';

// RFC 9728 protected-resource metadata: points MCP clients at Supabase Auth as the authorization server.
// Built on first use, so a missing Supabase URL fails the request with a clear error, not the build.
let handler: ((req: Request) => Response) | undefined;
const preflight = metadataCorsOptionsRequestHandler();

export function GET(req: Request) {
  if (isLocalAuthMode()) return new Response('Not found', { status: 404 });
  handler ??= protectedResourceHandler({ authServerUrls: [authIssuer()] });
  return handler(req);
}

export function OPTIONS() {
  if (isLocalAuthMode()) return new Response('Not found', { status: 404 });
  return preflight();
}
