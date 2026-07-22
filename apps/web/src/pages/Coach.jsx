import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send, Plus, Trash2, MessageSquare,
  Sparkles, Loader2, User as UserIcon,
  PanelLeft, X, RotateCcw,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  coachService,
  coachErrorInfo,
  newIdempotencyKey,
  replaceTailAssistant,
  appendOutgoing,
} from '../api/coachApi';
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
function MessageBubble({ message, isStreaming, isTail, onRetry }) {
  const isUser = message.role === 'user';
  // Present ONLY when retrying can honestly help (coachErrorInfo decides —
  // e.g. a spent quota offers none, because a retry cannot give it back) AND
  // this bubble is the one a send would write to. The `isTail` half is the
  // second layer of the T3 V1 fix: appendOutgoing already withdraws stale
  // offers, and this makes the button structurally incapable of appearing
  // anywhere the reply would not land, whatever future code does to the list.
  const retry = isTail ? message.retry : undefined;

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
            {/* remark-gfm renders GitHub-flavoured markdown — TABLES above all.
                Added 2026-07-22 after the coach-model smoke: gpt-oss-20b answers
                macro questions with tables, and plain react-markdown has no
                table support, so every cell and divider collapsed into one
                run-on paragraph of "|" and "---". Also gives us strikethrough
                and auto-links. */}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || ' '}</ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-0.5 align-middle"
                    style={{ background: '#FF8A1F', animation: 'blink 1s infinite' }} />
            )}
            {/* Resends the SAME question under the SAME Idempotency-Key, so the
                server recognises the repeat instead of opening a second
                conversation and spending a second question. Retyping — the only
                route back before this existed — is a brand-new message. */}
            {retry !== undefined && (
              <button
                type="button"
                onClick={() => onRetry?.(retry)}
                disabled={isStreaming}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: 'rgba(255,138,31,0.12)',
                  border:     '1px solid rgba(255,138,31,0.35)',
                  color:      '#FFB347',
                  cursor:     isStreaming ? 'not-allowed' : 'pointer',
                  opacity:    isStreaming ? 0.5 : 1,
                }}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Try again
              </button>
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
      // New /v1 API (Card 4): {items: [{id, title, lastMessageAt}], nextCursor}
      const res = await coachService.listThreads();
      setConversations(res.data.items || []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoadingConvs(false);
    }
  };

  const loadConversation = async (id) => {
    if (streaming) return;
    try {
      // New /v1 API (Card 4): the thread detail object directly.
      const res = await coachService.getThread(id);
      setMessages(res.data.messages || []);
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
      await coachService.deleteThread(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  // ── Send message (non-streaming — DECISIONS 2026-07-11 P2.5 GAP-3) ─────────
  //
  // ONE delivery path, shared by a first send and by "Try again", because the
  // retry must reproduce the request EXACTLY: the server fingerprints the whole
  // validated body (message + threadId) against the Idempotency-Key, so any
  // difference is correctly a 400 mismatch rather than a recognised repeat.
  // `threadId` is therefore whatever was captured when the message was COMPOSED
  // — never re-read from `activeId` at click time.
  const performSend = async ({ text, key, threadId }) => {
    setStreaming(true);
    // Back to the typing indicator: on a retry this clears the failure copy and
    // its button, so the failed bubble cannot be clicked twice.
    setMessages((prev) => replaceTailAssistant(prev, { role: 'assistant', content: '' }));

    try {
      // New /v1 API (Card 4): one complete response — {threadId, reply, cached}.
      // A recognised repeat returns the FIRST attempt's answer (and an
      // Idempotent-Replay header) — same shape, so nothing here changes.
      const res = await coachService.sendMessage(text, threadId, key);
      const { threadId: answeredThreadId, reply } = res.data;
      if (!activeId) setActiveId(answeredThreadId); // server minted or resumed one

      setMessages((prev) => replaceTailAssistant(prev, { role: 'assistant', content: reply }));
    } catch (err) {
      // message only — the axios error carries the request config, i.e. the
      // user's own question (R3.10; the Card-6 console-leak precedent).
      console.error('Coach chat error:', err?.message);

      // Branch on the error NAME, never the status: two different 429s mean
      // opposite things and two different 409s give opposite advice.
      const { content, retry } = coachErrorInfo(err);
      setMessages((prev) => replaceTailAssistant(prev, {
        role: 'assistant',
        content,
        // Absent when retrying cannot help — no button rather than a false offer.
        ...(retry === null ? {} : {
          retry: {
            text,
            threadId,
            // 'fresh-key' ONLY for a key error, where the server holds no answer
            // bound to this body and the same key would 400 forever.
            key: retry === 'fresh-key' ? newIdempotencyKey() : key,
          },
        }),
      }));
    } finally {
      setStreaming(false);
      loadConversations();
    }
  };

  const sendMessage = async (messageText) => {
    const text = (messageText || input).trim();
    if (!text || streaming) return;

    setInput('');
    // The key is minted HERE — once per composed message — and then travels with
    // that message. Minting it inside the request would produce a different key
    // on every attempt, which dedupes nothing while looking correct.
    const key = newIdempotencyKey();

    // User message + the empty assistant placeholder the typing indicator uses —
    // and appendOutgoing withdraws any earlier retry offer, because a send
    // writes to the TAIL and only the tail may be retryable (T3 V1).
    setMessages((prev) => appendOutgoing(prev, text));

    await performSend({ text, key, threadId: activeId });
  };

  // The retry payload is the one captured at compose time — same text, same
  // thread, same key. The input box is deliberately NOT restored: this button is
  // the retry path, and retyping would be a new question to the server.
  const handleRetry = async (retry) => {
    if (streaming || !retry) return;
    await performSend(retry);
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
                            {/* Card 4 D2(a): the new list item carries no
                                preview snippet — show last activity instead
                                (real data, nothing invented). */}
                            {conv.lastMessageAt
                              ? formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: true })
                              : 'No messages yet' /* T3 Card 4: title fallback already says "New Chat" */}
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
                  isTail={i === messages.length - 1}
                  onRetry={handleRetry}
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
        /* TABLES (2026-07-22, coach-model smoke). gpt-oss-20b answers macro
           questions with tables; without these they render unstyled and a wide
           one would blow out the chat bubble on a phone. The wrapper scrolls
           SIDEWAYS rather than letting the page scroll horizontally. */
        .coach-markdown table {
          /* display:block makes the table its OWN scroll container, so a wide
             table scrolls sideways inside the bubble instead of widening the
             page. Done in CSS rather than a JSX wrapper: no extra component,
             nothing to keep in sync. */
          display: block;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border-collapse: collapse;
          margin: 0.6em 0;
          font-size: 0.92em;
        }
        .coach-markdown th, .coach-markdown td {
          border: 1px solid rgba(255,255,255,0.10);
          padding: 0.4em 0.65em;
          text-align: left;
          vertical-align: top;
          white-space: nowrap;
        }
        .coach-markdown th {
          background: rgba(255,138,31,0.12);
          color: #FFB347;
          font-weight: 600;
        }
        .coach-markdown tbody tr:nth-child(even) td {
          background: rgba(255,255,255,0.025);
        }
      `}</style>
    </div>
    </div>
  );
}