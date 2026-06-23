import { prisma } from '../../shared/lib/prisma.js'
import { NotFoundError } from '../../shared/utils/errors.js'

const conversationSelect = {
  id: true,
  title: true,
  saveId: true,
  createdAt: true,
  updatedAt: true,
} as const

const messageSelect = {
  id: true,
  role: true,
  content: true,
  openaiResponseId: true,
  createdAt: true,
} as const

export async function createConversation(userId: string, opts: { title?: string; saveId?: string }) {
  if (opts.saveId) {
    const save = await prisma.save.findFirst({
      where: { id: opts.saveId, userId, deletedAt: null },
      select: { id: true },
    })
    if (!save) throw new NotFoundError('Save not found')
  }
  return prisma.chatConversation.create({
    data: { userId, saveId: opts.saveId ?? null, title: opts.title ?? null },
    select: conversationSelect,
  })
}

export async function listConversations(userId: string, opts: { saveId?: string }) {
  return prisma.chatConversation.findMany({
    where: { userId, ...(opts.saveId ? { saveId: opts.saveId } : {}) },
    select: conversationSelect,
    orderBy: { updatedAt: 'desc' },
  })
}

export async function deleteConversation(id: string, userId: string) {
  const conv = await prisma.chatConversation.findFirst({ where: { id, userId }, select: { id: true } })
  if (!conv) throw new NotFoundError('Conversation not found')
  await prisma.chatConversation.delete({ where: { id } })
}

export async function getMessages(conversationId: string, userId: string) {
  const conv = await prisma.chatConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } })
  if (!conv) throw new NotFoundError('Conversation not found')
  return prisma.chatMessage.findMany({
    where: { conversationId },
    select: messageSelect,
    orderBy: { createdAt: 'asc' },
  })
}

export async function assertConversationAccess(conversationId: string, userId: string) {
  const conv = await prisma.chatConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } })
  if (!conv) throw new NotFoundError('Conversation not found')
}

export async function getConversationSaveId(conversationId: string): Promise<string | null> {
  const conv = await prisma.chatConversation.findFirst({
    where: { id: conversationId },
    select: { saveId: true },
  })
  return conv?.saveId ?? null
}

export async function getLastOpenaiResponseId(conversationId: string): Promise<string | null> {
  const msg = await prisma.chatMessage.findFirst({
    where: { conversationId, role: 'assistant', openaiResponseId: { not: null } },
    select: { openaiResponseId: true },
    orderBy: { createdAt: 'desc' },
  })
  return msg?.openaiResponseId ?? null
}

/**
 * Persists a standalone assistant message (no preceding user turn) — used to seed a proactive
 * opening message when a save-pinned conversation is created. Its `openaiResponseId` becomes the
 * chain anchor, so the user's first turn continues from it.
 */
export async function seedAssistantMessage(
  conversationId: string,
  content: string,
  openaiResponseId: string,
) {
  await prisma.$transaction([
    prisma.chatMessage.create({
      data: { conversationId, role: 'assistant', content, openaiResponseId },
    }),
    prisma.chatConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ])
}

export async function persistTurn(
  conversationId: string,
  userContent: string,
  assistantContent: string,
  openaiResponseId: string,
) {
  await prisma.$transaction([
    prisma.chatMessage.create({ data: { conversationId, role: 'user', content: userContent } }),
    prisma.chatMessage.create({
      data: { conversationId, role: 'assistant', content: assistantContent, openaiResponseId },
    }),
    prisma.chatConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ])
}
