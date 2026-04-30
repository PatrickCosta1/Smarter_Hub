import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePortal } from '../portal/context';
import { getInitialSuggestions, resolveAssistantReply } from '../portal/chatbot-kb';

type MessageRole = 'user' | 'bot';

type Message = {
  id: number;
  role: MessageRole;
  text: string;
  timestamp: Date;
};

let _msgId = 0;
function nextId() {
  return ++_msgId;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatbotWidget() {
  const { isRootAccess, isAccessTotal, userRole, hasPermission, currentUser } = usePortal();
  const location = useLocation();
  const ctx = {
    isRootAccess,
    isAccessTotal,
    userRole,
    hasPermission,
    currentPath: location.pathname,
    username: currentUser?.username,
  };

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [initialised, setInitialised] = useState(false);
  const [followupSuggestions, setFollowupSuggestions] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggestions = getInitialSuggestions(ctx);

  const GREETING = ctx.username
    ? `Olá, **${ctx.username}**! Sou o assistente do Smarter Hub. Respondo com base no teu acesso e na página onde estás.`
    : 'Olá! Sou o assistente do Smarter Hub. Respondo com base no teu acesso e na página onde estás.';

  useEffect(() => {
    if (open && !initialised) {
      setMessages([{ id: nextId(), role: 'bot', text: GREETING, timestamp: new Date() }]);
      setFollowupSuggestions(suggestions);
      setInitialised(true);
      setUnreadCount(0);
    }
    if (open) {
      setUnreadCount(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  function handleToggle() {
    setOpen((prev) => !prev);
  }

  function handleClear() {
    setMessages([{ id: nextId(), role: 'bot', text: GREETING, timestamp: new Date() }]);
    setFollowupSuggestions(suggestions);
    setInitialised(true);
  }

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: Message = { id: nextId(), role: 'user', text: trimmed, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setFollowupSuggestions([]);
    setIsTyping(true);

    const delay = 150 + Math.random() * 200;
    setTimeout(() => {
      const reply = resolveAssistantReply(trimmed, ctx);
      const botMsg: Message = { id: nextId(), role: 'bot', text: reply.text, timestamp: new Date() };
      setIsTyping(false);
      setMessages((prev) => [...prev, botMsg]);
      setFollowupSuggestions(reply.suggestions.length > 0 ? reply.suggestions : suggestions);
      if (!open) setUnreadCount((c) => c + 1);
    }, delay);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  /** Renderiza texto simples com suporte a **negrito** e quebras de linha */
  function renderText(text: string) {
    return text.split('\n').map((line, lineIdx) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <span key={lineIdx}>
          {parts.map((part, partIdx) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={partIdx}>{part.slice(2, -2)}</strong>;
            }
            return <span key={partIdx}>{part}</span>;
          })}
          {lineIdx < text.split('\n').length - 1 && <br />}
        </span>
      );
    });
  }

  const showSuggestions = followupSuggestions.length > 0;

  return (
    <div
      className="chatbot-root"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 2147483000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 10,
        pointerEvents: 'auto',
      }}
    >
      {open && (
        <div
          className="chatbot-window"
          role="dialog"
          aria-label="Assistente Smarter Hub"
          style={{
            width: 360,
            maxHeight: 520,
            background: 'rgba(255,255,255,0.98)',
            border: '1px solid rgba(200,220,255,0.85)',
            borderRadius: 20,
            boxShadow: '0 20px 60px rgba(7,34,101,0.22), 0 4px 16px rgba(7,34,101,0.1)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <header
            className="chatbot-header"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              background: 'linear-gradient(135deg, #2d63d8 0%, #183f84 100%)',
              color: '#fff',
            }}
          >
            <span className="chatbot-header__icon" aria-hidden="true">💬</span>
            <span className="chatbot-header__title" style={{ flex: 1 }}>Assistente Smarter Hub</span>
            <button
              type="button"
              onClick={handleClear}
              title="Limpar conversa"
              aria-label="Limpar conversa"
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                fontSize: 12,
                padding: '3px 7px',
                cursor: 'pointer',
                marginRight: 4,
              }}
            >
              ↺
            </button>
            <button
              className="chatbot-header__close"
              type="button"
              onClick={handleToggle}
              aria-label="Fechar assistente"
            >
              ✕
            </button>
          </header>

          <div
            className="chatbot-messages"
            role="log"
            aria-live="polite"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '14px 14px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`chatbot-message chatbot-message--${msg.role}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={msg.role === 'user'
                    ? {
                      maxWidth: '88%',
                      padding: '9px 13px',
                      borderRadius: 14,
                      borderBottomRightRadius: 4,
                      color: '#fff',
                      background: 'linear-gradient(135deg, #2d63d8, #183f84)',
                      fontSize: 13,
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                    }
                    : {
                      maxWidth: '88%',
                      padding: '9px 13px',
                      borderRadius: 14,
                      borderBottomLeftRadius: 4,
                      color: '#1a2d50',
                      background: 'linear-gradient(180deg, #f3f8ff, #eaf2ff)',
                      border: '1px solid #d0e4ff',
                      fontSize: 13,
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                    }}
                >
                  {renderText(msg.text)}
                </div>
                <span style={{ fontSize: 10, color: '#a0aec0', marginTop: 2, paddingInline: 4 }}>
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            ))}

            {isTyping && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  padding: '9px 14px',
                  borderRadius: 14,
                  borderBottomLeftRadius: 4,
                  background: 'linear-gradient(180deg, #f3f8ff, #eaf2ff)',
                  border: '1px solid #d0e4ff',
                  display: 'flex',
                  gap: 5,
                  alignItems: 'center',
                }}
                aria-label="A escrever..."
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#6b8dd6',
                      display: 'inline-block',
                      animation: `chatbot-bounce 1s ease-in-out ${i * 0.15}s infinite`,
                    }}
                  />
                ))}
              </div>
            )}

            {showSuggestions && !isTyping && (
              <div className="chatbot-suggestions">
                {followupSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chatbot-suggestion"
                    onClick={() => sendMessage(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <form
            className="chatbot-form"
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              gap: 8,
              padding: '10px 12px',
              borderTop: '1px solid #e4eeff',
              background: '#f9fcff',
            }}
          >
            <input
              ref={inputRef}
              className="chatbot-input"
              type="text"
              placeholder="Escreve a tua dúvida..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={300}
              autoComplete="off"
            />
            <button
              className="chatbot-send"
              type="submit"
              aria-label="Enviar mensagem"
              disabled={!input.trim()}
            >
              ➤
            </button>
          </form>
        </div>
      )}

      <div style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          className={`chatbot-bubble${open ? ' chatbot-bubble--open' : ''}`}
          type="button"
          onClick={handleToggle}
          aria-label={open ? 'Fechar assistente' : 'Abrir assistente'}
          title="Assistente Smarter Hub"
          style={{
            width: 58,
            height: 58,
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.62)',
            background: open
              ? 'linear-gradient(140deg, #ef4444 0%, #b91c1c 100%)'
              : 'linear-gradient(140deg, #2563eb 0%, #0f3fa7 100%)',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: 22,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: open
              ? '0 10px 28px rgba(185,28,28,0.35)'
              : '0 10px 28px rgba(15,63,167,0.35)',
            backdropFilter: 'blur(2px)',
            cursor: 'pointer',
            transition: 'transform 160ms ease, box-shadow 160ms ease, filter 160ms ease',
          }}
        >
          {open ? '✕' : '💬'}
        </button>
        {!open && unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} mensagens não lidas`}
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 20,
              height: 20,
              borderRadius: 999,
              background: '#ef4444',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              border: '2px solid #fff',
              pointerEvents: 'none',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </div>
    </div>
  );
}
