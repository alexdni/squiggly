// RFC 9728 path-specific metadata for the /api/mcp resource: the shared handler derives `resource`
// from the request path, so this document advertises `<origin>/api/mcp`, the MCP endpoint itself.
import { GET as metadata, OPTIONS as preflight } from '../../route';

export function GET(req: Request) {
  return metadata(req);
}

export function OPTIONS() {
  return preflight();
}
