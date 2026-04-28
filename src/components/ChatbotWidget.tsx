import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePortal } from '../portal/context';
import { getInitialSuggestions, resolveAssistantReply } from '../portal/chatbot-kb';

type MessageRole = 'user' | 'bot';

type Message = {
  id: number;
  role: MessageRole;
  text: string;
};

const GREETING =
  'Olá! Sou o assistente do Smarter Hub. Eu respondo com base no teu acesso atual e na página onde estás.';

let _msgId = 0;
function nextId() {
  return ++_msgId;
}

export default function ChatbotWidget() {
  const { isRootAccess, isAccessTotal, userRole, hasPermission } = usePortal();
  const location = useLocation();
  const ctx = { isRootAccess, isAccessTotal, userRole, hasPermission, currentPath: location.pathname };

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [initialised, setInitialised] = useState(false);
  const [followupSuggestions, setFollowupSuggestions] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggestions = getInitialSuggestions(ctx);

  useEffect(() => {
    if (open && !initialised) {
      setMessages([{ id: nextId(), role: 'bot', text: GREETING }]);
      setFollowupSuggestions(suggestions);
      setInitialised(true);
    }
  }, [open, initialised, suggestions]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  function handleToggle() {
    setOpen((prev) => !prev);
  }

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: Message = { id: nextId(), role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    const reply = resolveAssistantReply(trimmed, ctx);
    const botText = reply.text;
    setFollowupSuggestions(reply.suggestions.length > 0 ? reply.suggestions : suggestions);

    const botMsg: Message = { id: nextId(), role: 'bot', text: botText };
    setMessages((prev) => [...prev, botMsg]);
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
            <span className="chatbot-header__title">Assistente Smarter Hub</span>
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
                style={msg.role === 'user'
                  ? {
                    alignSelf: 'flex-end',
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
                    alignSelf: 'flex-start',
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
            ))}

            {showSuggestions && suggestions.length > 0 && (
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
    </div>
  );
}
