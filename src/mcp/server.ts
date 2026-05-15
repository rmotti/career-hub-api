import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './context.js'
import { registerTools } from './tools/index.js'
import { registerResources } from './resources/index.js'

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: 'career-hub', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  )
  registerTools(server, ctx)
  registerResources(server, ctx)
  return server
}
