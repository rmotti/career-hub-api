export type McpContext = {
  userId: string
  sessionToken: string
  /**
   * Save the conversation is pinned to (resolved from the chat conversation when the MCP
   * token is minted). Tools prefer this over "most recently updated save" so the bot always
   * answers about the save the user is actually chatting in. Absent for direct MCP clients.
   */
  saveId?: string
}
