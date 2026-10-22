import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler';
import { isLocalAuthMode } from '@/lib/auth';
import { AUTH_ISSUER } from '@/lib/server/mcp/auth';

// RFC 9728 protected-resource metadata: points MCP clients at Supabase Auth as the authorization server.
const handler = protectedResourceHandler({ authServerUrls: [AUTH_ISSUER] });
const preflight = metadataCorsOptionsRequestHandler();

export function GET(req: Request) {
  if (isLocalAuthMode()) return new Response('Not found', { status: 404 });
  return handler(req);
}

export function OPTIONS() {
  if (isLocalAuthMode()) return new Response('Not found', { status: 404 });
  return preflight();
}
