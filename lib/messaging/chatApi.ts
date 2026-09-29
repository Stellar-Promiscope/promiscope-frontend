import api from '@/lib/api';

/**
 * Canonical client for the Node.js off-chain chat/comments API referenced in
 * CONTRIBUTING.md and the architecture diagram — persists message history
 * for a scout/player thread once pay-to-contact has been unlocked. Reuses the
 * shared axios instance from lib/api.ts (base URL resolution + interceptors).
 * The sender is always derived server-side from the session; never send it.
 */
const chatApi = api;

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: string;
  status: 'sent' | 'delivered' | 'read';
}

export async function fetchThreadMessages(
  threadId: string,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  const { data } = await chatApi.get<ChatMessage[]>(
    `/threads/${threadId}/messages`,
    { signal },
  );
  return data;
}

export async function sendThreadMessage(
  threadId: string,
  body: string,
): Promise<ChatMessage> {
  const { data } = await chatApi.post<ChatMessage>(
    `/threads/${threadId}/messages`,
    { body },
  );
  return data;
}

export async function markThreadRead(threadId: string): Promise<void> {
  await chatApi.post(`/threads/${threadId}/read`);
}

export default chatApi;
