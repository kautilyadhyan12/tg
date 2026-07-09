import mlApi from './mlApi';

const ML_BASE = import.meta.env.VITE_ML_API_URL || 'http://localhost:8000/api';

export const coachService = {
  // List recent conversations
  listConversations: () => mlApi.get('/coach/conversations'),

  // Get one full conversation
  getConversation: (id) => mlApi.get(`/coach/conversations/${id}`),

  // Delete a conversation
  deleteConversation: (id) => mlApi.delete(`/coach/conversations/${id}`),

  // Send a message — returns a streaming Response (use fetch directly for streaming)
  streamChat: async (message, conversationId = null) => {
    const token = localStorage.getItem('accessToken');
    const response = await fetch(`${ML_BASE}/coach/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Chat failed: ${response.status}`);
    }

    return response;
  },
};