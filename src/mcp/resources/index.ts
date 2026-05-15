import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from '../context.js'
import { registerPlaybookResource } from './playbook.js'
import { registerDossierResource } from './dossier.js'

export function registerResources(server: McpServer, ctx: McpContext) {
  registerPlaybookResource(server, ctx)
  registerDossierResource(server, ctx)
}
