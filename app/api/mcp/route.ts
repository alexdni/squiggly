import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import type { ServerContext } from '@modelcontextprotocol/server';
import { isLocalAuthMode } from '@/lib/auth';
import { getMcpUser, verifyMcpToken } from '@/lib/server/mcp/auth';
import { MCP_SERVER_OPTIONS, registerSquigglyTools, type McpCtx } from '@/lib/server/mcp/server';

export const dynamic = 'force-dynamic';

/** Path-specific RFC 9728 metadata, so the advertised resource is this endpoint, not the bare origin. */
const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp';

function ctxFromAuth(extra: ServerContext): McpCtx | null {
  const authInfo = extra.http?.authInfo;
  if (!authInfo) return null;
  return { ...getMcpUser(authInfo), clientId: authInfo.clientId };
}

const handler = withMcpAuth(
  createMcpHandler((server) => registerSquigglyTools(server, ctxFromAuth), MCP_SERVER_OPTIONS),
  verifyMcpToken,
  { required: true, resourceMetadataPath: RESOURCE_METADATA_PATH },
);

async function mcp(req: Request): Promise<Response> {
  if (isLocalAuthMode()) return new Response('Not found', { status: 404 });
  return handler(req);
}

export { mcp as GET, mcp as POST, mcp as DELETE };
