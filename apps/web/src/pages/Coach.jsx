import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import {
  Send, Plus, Trash2, MessageSquare,
  Sparkles, Loader2, User as UserIcon,
  PanelLeft, X,
} from 'lucide-react';
import { coachService } from '../api/coachApi';
import { useAuth } from '../context/AuthContext';

// ── Suggested prompts shown when chat is empty ────────────────────────────────
const SUGGESTED_PROMPTS = [
  {
    icon: '🏋️',
    title: 'Form check',
    prompt: "How do I do a proper squat? What are the most common mistakes?",
  },
  {
    icon: '💪',
    title: 'Build a routine',
    prompt: "I'm a beginner with no equipment. Build me a 3-day full-body routine.",
  },
  {
    icon: '🍗',
    title: 'Nutrition help',
    prompt: "How much protein should I eat to build muscle? Give me meal examples.",
  },
  {
    icon: '😴',
    title: 'Recovery tips',
    prompt: "I'm always sore. What can I do to recover faster between workouts?",
  },
];

// ── Single message bubble ─────────────────────────────────────────────────────
function MessageBubble({ message, isStreaming }) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-1"
          style={{
            background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
            boxShadow:  '0 0 16px rgba(255,138,31,0.25)',
          }}
        >
          <Sparkles className="w-4 h-4 text-white" />
        </div>
      )}

      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 ${isUser ? 'order-1' : ''}`}
        style={{
          background: isUser
            ? 'linear-gradient(135deg, #FF8A1F, #FFB347)'
            : 'rgba(255,255,255,0.04)',
          border:  isUser ? 'none' : '1px solid rgba(255,255,255,0.06)',
          color:   isUser ? '#fff' : 'rgba(255,255,255,0.92)',
        }}
      >
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="text-sm leading-relaxed coach-markdown">
            <ReactMarkdown>{message.content || ' '}</ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-0.5 align-middle"
                    style={{ background: '#FF8A1F', animation: 'blink 1s infinite' }} />
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-1 order-2"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border:     '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <UserIcon className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.6)' }} />
        </div>
      )}
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Coach() {
  const { user } = useAuth();

  const [conversations,   setConversations]   = useState([]);
  const [activeId,        setActiveId]        = useState(null);
  const [messages,        setMessages]        = useState([]);
  const [input,           setInput]           = useState('');
  const [streaming,       setStreaming]       = useState(false);
  const [loadingConvs,    setLoadingConvs]    = useState(false);
  const [sidebarOpen,     setSidebarOpen]     = useState(false);

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Load conversation list on mount ─────────────────────────────────────────
  useEffect(() => {
    loadConversations();
  }, []);

  // ── Auto-scroll to bottom when messages change ──────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadConversations = async () => {
    setLoadingConvs(true);
    try {
      const res = await coachService.listConversations();
      setConversations(res.data.conversations || []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoadingConvs(false);
    }
  };

  const loadConversation = async (id) => {
    if (streaming) return;
    try {
      const res = await coachService.getConversation(id);
      setMessages(res.data.conversation.messages || []);
      setActiveId(id);
      setSidebarOpen(false);   // Auto-close sidebar after selection
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  };

  const startNewChat = () => {
    if (streaming) return;
    setActiveId(null);
    setMessages([]);
    setSidebarOpen(false);     // Auto-close sidebar
    inputRef.current?.focus();
  };

  const handleDeleteConv = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation?')) return;
    try {
      await coachService.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  // ── Send message and stream response ────────────────────────────────────────
  const sendMessage = async (messageText) => {
    const text = (messageText || input).trim();
    if (!text || streaming) return;

    setInput('');
    setStreaming(true);

    // Add user message
    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    // Add empty assistant message that we'll stream into
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    let currentConvId = activeId;

    try {
      const response = await coachService.streamChat(text, activeId);
      const reader   = response.body.getReader();
      const decoder  = new TextDecoder();

      let buffer       = '';
      let gotConvId    = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Parse conversation_id from first line
        if (!gotConvId && buffer.includes('\n')) {
          const lines     = buffer.split('\n');
          const firstLine = lines[0];

          if (firstLine.startsWith('__CONV_ID__:')) {
            currentConvId = firstLine.replace('__CONV_ID__:', '');
            buffer        = lines.slice(1).join('\n');
            gotConvId     = true;
            setActiveId(currentConvId);
          } else {
            gotConvId = true;
          }
        }

        // Update last message with accumulated text
        setMessages((prev) => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
            updated[updated.length - 1] = {
              role:    'assistant',
              content: buffer,
            };
          }
          return updated;
        });
      }
    } catch (err) {
      console.error('Streaming error:', err);
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
          updated[updated.length - 1] = {
            role:    'assistant',
            content: 'Sorry, I ran into an error. Please try again.',
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
      loadConversations();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-screen flex relative overflow-hidden">
      {/* Fixed background image — stays still while content scrolls */}
      <div
        style={{
          position:   'fixed',
          inset:       0,
          zIndex:      0,
          backgroundImage:    'url(/images/dashboard/chatbotbackground.png)',
          backgroundSize:     'contain',
          backgroundPosition: 'center bottom',
          backgroundRepeat:   'no-repeat',
        }}
      />
      {/* Dark overlay so chat UI stays readable */}
      <div
        style={{
          position: 'fixed',
          inset:     0,
          zIndex:    1,
          background: 'rgba(10,9,8,0.72)',
        }}
      />
      {/* Wrapper so all existing children sit above the bg */}
      <div className="h-screen flex relative w-full" style={{ zIndex: 2 }}>

      {/* ── Collapsed sidebar rail (always visible, 48px wide) ──────────────── */}
      <div
        className="w-12 flex-shrink-0 flex flex-col items-center py-4 gap-2 z-10"
        style={{
          background:  '#0D0C0B',
          borderRight: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {/* Toggle button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
          style={{
            background: sidebarOpen ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
            border:     sidebarOpen ? '1px solid rgba(255,138,31,0.25)' : '1px solid rgba(255,255,255,0.06)',
          }}
          title={sidebarOpen ? 'Close history' : 'Open history'}
        >
          <PanelLeft
            className="w-4 h-4 transition-colors"
            style={{ color: sidebarOpen ? '#FF8A1F' : 'rgba(255,255,255,0.5)' }}
          />
        </button>

        {/* New chat button */}
        <button
          onClick={startNewChat}
          disabled={streaming}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
          style={{
            background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
            boxShadow:  '0 4px 12px rgba(255,138,31,0.25)',
            opacity:    streaming ? 0.5 : 1,
          }}
          title="New chat"
        >
          <Plus className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* ── Slide-in sidebar with conversations ─────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            {/* Backdrop — click to close */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{    opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 z-20"
              style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
            />

            {/* Panel */}
            <motion.div
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0,    opacity: 1 }}
              exit={{    x: -300, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute left-12 top-0 bottom-0 w-72 z-30 flex flex-col"
              style={{
                background:  '#0D0C0B',
                borderRight: '1px solid rgba(255,255,255,0.06)',
                boxShadow:   '8px 0 24px rgba(0,0,0,0.4)',
              }}
            >
              {/* Header */}
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wider"
                     style={{ color: '#FF8A1F' }}>
                    History
                  </p>
                  <p className="text-xs mt-0.5"
                     style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {conversations.length} {conversations.length === 1 ? 'chat' : 'chats'}
                  </p>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)' }}
                >
                  <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
                </button>
              </div>

              {/* New chat button */}
              <div className="p-3">
                <button
                  onClick={startNewChat}
                  disabled={streaming}
                  className="w-full flex items-center justify-center gap-2 py-2.5
                             rounded-xl font-semibold text-sm text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                    boxShadow:  '0 4px 16px rgba(255,138,31,0.25)',
                    opacity:    streaming ? 0.5 : 1,
                  }}
                >
                  <Plus className="w-4 h-4" />
                  New Chat
                </button>
              </div>

              {/* Conversation list */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 no-scrollbar">
                {loadingConvs ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin"
                             style={{ color: 'rgba(255,255,255,0.3)' }} />
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="text-center py-10 px-4">
                    <MessageSquare
                      className="w-8 h-8 mx-auto mb-2"
                      style={{ color: 'rgba(255,255,255,0.15)' }}
                    />
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.30)' }}>
                      No conversations yet
                    </p>
                  </div>
                ) : (
                  conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => loadConversation(conv.id)}
                      disabled={streaming}
                      className="w-full text-left rounded-xl p-3 mb-1.5
                                 group transition-all relative"
                      style={{
                        background: activeId === conv.id
                          ? 'rgba(255,138,31,0.10)'
                          : 'transparent',
                        border: activeId === conv.id
                          ? '1px solid rgba(255,138,31,0.2)'
                          : '1px solid transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (activeId !== conv.id) {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (activeId !== conv.id) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white truncate">
                            {conv.title || 'New Chat'}
                          </p>
                          <p className="text-2xs mt-0.5 truncate"
                             style={{ color: 'rgba(255,255,255,0.35)' }}>
                            {conv.preview || 'No messages'}
                          </p>
                        </div>
                        <span
                          onClick={(e) => handleDeleteConv(conv.id, e)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity
                                     p-1 rounded-md cursor-pointer"
                          style={{ color: 'rgba(239,68,68,0.7)' }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Main chat area ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div
          className="px-6 py-4 flex items-center gap-3"
          style={{
            background:   '#0D0C0B',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
              boxShadow:  '0 0 20px rgba(255,138,31,0.3)',
            }}
          >
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">AI Coach</h1>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Your personal fitness guide
            </p>
          </div>
        </div>

        {/* Messages area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-6 no-scrollbar"
        >
          {messages.length === 0 ? (
            <div className="max-w-3xl mx-auto pt-12">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="text-center mb-10"
              >
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  style={{
                    background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                    boxShadow:  '0 8px 32px rgba(255,138,31,0.3)',
                  }}
                >
                  <Sparkles className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-white mb-2">
                  Hi {user?.displayName?.split(' ')[0] || 'there'} 👋
                </h2>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  I'm your AI fitness coach. Ask me anything about training,
                  form, nutrition, or recovery.
                </p>
              </motion.div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SUGGESTED_PROMPTS.map((p, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 * i }}
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => sendMessage(p.prompt)}
                    className="text-left rounded-2xl p-4 transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border:     '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="text-2xl mb-2">{p.icon}</div>
                    <p className="text-sm font-semibold text-white mb-1">
                      {p.title}
                    </p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
                      {p.prompt}
                    </p>
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-5">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={i}
                  message={msg}
                  isStreaming={streaming && i === messages.length - 1 && msg.role === 'assistant'}
                />
              ))}
            </div>
          )}
        </div>

        {/* Input area */}
        <div
          className="p-4"
          style={{
            background: '#0D0C0B',
            borderTop:  '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <form
            onSubmit={handleSubmit}
            className="max-w-3xl mx-auto flex items-end gap-3"
          >
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={streaming
                  ? 'Coach is thinking...'
                  : 'Ask anything — form, nutrition, programming...'}
                disabled={streaming}
                rows={1}
                className="w-full px-4 py-3 rounded-2xl text-sm
                           resize-none focus:outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border:     '1px solid rgba(255,255,255,0.08)',
                  color:      '#fff',
                  maxHeight:  120,
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(255,138,31,0.4)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255,255,255,0.08)';
                }}
              />
            </div>

            <button
              type="submit"
              disabled={!input.trim() || streaming}
              className="w-12 h-12 rounded-2xl flex items-center
                         justify-center flex-shrink-0 transition-all"
              style={{
                background: input.trim() && !streaming
                  ? 'linear-gradient(135deg, #FF8A1F, #FFB347)'
                  : 'rgba(255,255,255,0.05)',
                boxShadow: input.trim() && !streaming
                  ? '0 4px 16px rgba(255,138,31,0.3)'
                  : 'none',
                opacity:   input.trim() && !streaming ? 1 : 0.5,
                cursor:    input.trim() && !streaming ? 'pointer' : 'not-allowed',
              }}
            >
              {streaming ? (
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              ) : (
                <Send className="w-5 h-5" style={{
                  color: input.trim() ? '#fff' : 'rgba(255,255,255,0.3)'
                }} />
              )}
            </button>
          </form>
        </div>
      </div>

      {/* ── Inline styles for markdown + blinking cursor ────────────────────── */}
      <style>{`
        @keyframes blink {
          0%, 50%   { opacity: 1; }
          50.01%, 100% { opacity: 0; }
        }
        .coach-markdown p           { margin: 0 0 0.6em 0; }
        .coach-markdown p:last-child { margin-bottom: 0; }
        .coach-markdown strong      { color: #FFB347; font-weight: 600; }
        .coach-markdown em          { color: rgba(255,255,255,0.85); }
        .coach-markdown ul, .coach-markdown ol {
          margin: 0.5em 0; padding-left: 1.4em;
        }
        .coach-markdown li          { margin: 0.3em 0; }
        .coach-markdown li::marker  { color: #FF8A1F; }
        .coach-markdown h1, .coach-markdown h2, .coach-markdown h3 {
          color: #fff; font-weight: 700; margin: 0.8em 0 0.4em 0;
        }
        .coach-markdown h1 { font-size: 1.15em; }
        .coach-markdown h2 { font-size: 1.08em; }
        .coach-markdown h3 { font-size: 1.02em; }
        .coach-markdown code {
          background: rgba(255,138,31,0.10);
          border:     1px solid rgba(255,138,31,0.15);
          padding:    0.1em 0.4em;
          border-radius: 4px;
          font-size:  0.9em;
          color:      #FFB347;
        }
        .coach-markdown pre {
          background: rgba(0,0,0,0.4);
          border:     1px solid rgba(255,255,255,0.06);
          padding:    0.7em;
          border-radius: 8px;
          overflow-x: auto;
          margin: 0.5em 0;
        }
        .coach-markdown pre code {
          background: none;
          border: none;
          padding: 0;
          color: rgba(255,255,255,0.85);
        }
      `}</style>
    </div>
    </div>
  );
}