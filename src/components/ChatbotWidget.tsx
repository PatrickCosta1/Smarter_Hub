import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';
import { getInitialSuggestions, resolveAssistantReply } from '../portal/chatbot-kb';

type MessageRole = 'user' | 'bot';

type Message = {
  id: number;
  role: MessageRole;
  text: string;
  timestamp: Date;
};

type ShortcutAction = {
  label: string;
  path: string;
};

type ReplyMode = 'concise' | 'detailed';

let _msgId = 0;
function nextId() {
  return ++_msgId;
}

const CHATBOT_HISTORY_KEY = 'smarter_hub_chatbot_history_v2';
const CHATBOT_HISTORY_LIMIT = 60;
const CHATBOT_MODE_KEY = 'smarter_hub_chatbot_mode_v1';

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function uniqueSuggestions(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of values) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }

  return out;
}

function sameSuggestions(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }

  return true;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

function resolveDayPeriod(): string {
  const hour = new Date().getHours();
  if (hour < 12) {
    return 'Bom dia';
  }
  if (hour < 19) {
    return 'Boa tarde';
  }
  return 'Boa noite';
}

function readablePath(pathname: string): string {
  const map: Record<string, string> = {
    '/': 'Home',
    '/dashboard': 'Dashboard',
    '/colaboradores': 'Colaboradores',
    '/aprovacoes': 'Aprovações',
    '/ferias': 'Férias / Ausências',
    '/banco-horas': 'Banco de Horas',
    '/equipas': 'Equipas',
    '/formacoes': 'Formações',
    '/profile': 'A Minha Ficha',
  };

  return map[pathname] ?? pathname;
}

export default function ChatbotWidget() {
  const navigate = useNavigate();
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
  const [replyMode, setReplyMode] = useState<ReplyMode>('detailed');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggestions = useMemo(
    () => getInitialSuggestions(ctx),
    [currentUser?.username, hasPermission, isAccessTotal, isRootAccess, location.pathname, userRole],
  );

  const isTPeople = (ctx.username ?? '').toLowerCase() === 't.people';

  const shortcutActions = useMemo<ShortcutAction[]>(() => {
    const items: ShortcutAction[] = [{ label: 'Abrir Férias / Ausências', path: '/ferias' }];

    if (ctx.isRootAccess || ctx.isAccessTotal) {
      items.push({ label: 'Abrir Dashboard', path: '/dashboard' });
    }

    if (ctx.hasPermission('view_user_list')) {
      items.push({ label: 'Abrir Colaboradores', path: '/colaboradores' });
    }

    if (ctx.hasPermission('approve_profile_change') || ctx.hasPermission('approve_vacation') || ctx.hasPermission('reject_vacation') || ctx.hasPermission('view_all_vacations')) {
      items.push({ label: 'Abrir Aprovações', path: '/aprovacoes' });
    }

    if (isTPeople || ctx.hasPermission('view_hours_bank') || ctx.hasPermission('manage_hours_bank') || ctx.isRootAccess || ctx.isAccessTotal) {
      items.push({ label: 'Abrir Banco de Horas', path: '/banco-horas' });
    }

    return items;
  }, [hasPermission, isTPeople, isAccessTotal, isRootAccess]);

  const turboSuggestions = useMemo(
    () => uniqueSuggestions([
      ...shortcutActions.map((item) => item.label),
      '/atalhos',
      '/limpar',
      '/resumo',
      '/copiar',
      replyMode === 'detailed' ? '/modo curto' : '/modo detalhado',
    ]),
    [replyMode, shortcutActions],
  );

  const dayPeriod = resolveDayPeriod();
  const currentArea = readablePath(location.pathname);

  const GREETING = ctx.username
    ? `${dayPeriod}, **${ctx.username}**! Sou o assistente do Smarter Hub. Estou contigo na área **${currentArea}**.`
    : `${dayPeriod}! Sou o assistente do Smarter Hub. Estou contigo na área **${currentArea}**.`;

  function mergeSuggestions(base: string[], extra: string[]) {
    return uniqueSuggestions([...base, ...extra]).slice(0, 10);
  }

  function persistMessages(nextMessages: Message[]) {
    try {
      const serializable = nextMessages.slice(-CHATBOT_HISTORY_LIMIT).map((msg) => ({
        ...msg,
        timestamp: msg.timestamp.toISOString(),
      }));
      localStorage.setItem(CHATBOT_HISTORY_KEY, JSON.stringify(serializable));
    } catch {
      // Ignore storage errors (quota/blocked storage)
    }
  }

  function restoreMessages(): Message[] {
    try {
      const raw = localStorage.getItem(CHATBOT_HISTORY_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as Array<{ id: number; role: MessageRole; text: string; timestamp: string }>;
      const restored = parsed
        .filter((item) => item && (item.role === 'user' || item.role === 'bot') && typeof item.text === 'string')
        .slice(-CHATBOT_HISTORY_LIMIT)
        .map((item) => ({
          id: item.id,
          role: item.role,
          text: item.text,
          timestamp: new Date(item.timestamp),
        }));

      const maxId = restored.reduce((max, item) => (item.id > max ? item.id : max), 0);
      if (maxId > _msgId) {
        _msgId = maxId;
      }

      return restored;
    } catch {
      return [];
    }
  }

  function appendBotMessage(text: string, nextSuggestions?: string[]) {
    const botMsg: Message = { id: nextId(), role: 'bot', text, timestamp: new Date() };
    setMessages((prev) => {
      const next = [...prev, botMsg];
      persistMessages(next);
      return next;
    });
    if (nextSuggestions) {
      setFollowupSuggestions(nextSuggestions);
    }
    if (!open) {
      setUnreadCount((count) => count + 1);
    }
  }

  function clearConversation() {
    const initialMessage: Message = { id: nextId(), role: 'bot', text: GREETING, timestamp: new Date() };
    setMessages([initialMessage]);
    setFollowupSuggestions(mergeSuggestions(suggestions, turboSuggestions));
    setInitialised(true);
    persistMessages([initialMessage]);
  }

  function openByShortcut(text: string): boolean {
    const normalized = normalize(text);
    const action = shortcutActions.find((item) => normalize(item.label) === normalized);
    if (!action) {
      return false;
    }

    navigate(action.path);
    appendBotMessage(`A abrir **${action.label.replace('Abrir ', '')}**.`, mergeSuggestions(getInitialSuggestions({ ...ctx, currentPath: action.path }), turboSuggestions));
    return true;
  }

  async function copyLastBotReply() {
    const lastBot = [...messages].reverse().find((msg) => msg.role === 'bot');
    if (!lastBot?.text) {
      appendBotMessage('Ainda não tenho resposta para copiar.', turboSuggestions);
      return;
    }

    try {
      await navigator.clipboard.writeText(lastBot.text);
      appendBotMessage('Última resposta copiada para a área de transferência.', turboSuggestions);
    } catch {
      appendBotMessage('Não foi possível copiar automaticamente. Tenta novamente com permissões de clipboard ativas.', turboSuggestions);
    }
  }

  function handleCommand(raw: string): boolean {
    const command = normalize(raw);

    if (command === '/limpar') {
      clearConversation();
      return true;
    }

    if (command === '/atalhos') {
      const lines = ['Atalhos disponíveis:'];
      for (const action of shortcutActions) {
        lines.push(`• ${action.label}`);
      }
      lines.push('• /resumo');
      lines.push('• /copiar');
      lines.push('• /limpar');
      lines.push('• /modo curto');
      lines.push('• /modo detalhado');
      appendBotMessage(lines.join('\n'), mergeSuggestions(suggestions, turboSuggestions));
      return true;
    }

    if (command === '/resumo') {
      const lastUserPrompts = messages
        .filter((item) => item.role === 'user')
        .slice(-3)
        .map((item, index) => `${index + 1}. ${item.text}`);

      appendBotMessage(
        lastUserPrompts.length > 0
          ? ['Resumo rápido dos teus últimos tópicos:', ...lastUserPrompts].join('\n')
          : 'Ainda não há perguntas suficientes para resumir. Envia uma questão e volto a resumir.',
        mergeSuggestions(suggestions, turboSuggestions),
      );
      return true;
    }

    if (command === '/copiar') {
      void copyLastBotReply();
      return true;
    }

    if (command === '/modo curto') {
      setReplyMode('concise');
      try {
        localStorage.setItem(CHATBOT_MODE_KEY, 'concise');
      } catch {
        // Ignore storage issues
      }
      appendBotMessage('Modo de resposta alterado para **curto**.', mergeSuggestions(suggestions, turboSuggestions));
      return true;
    }

    if (command === '/modo detalhado') {
      setReplyMode('detailed');
      try {
        localStorage.setItem(CHATBOT_MODE_KEY, 'detailed');
      } catch {
        // Ignore storage issues
      }
      appendBotMessage('Modo de resposta alterado para **detalhado**.', mergeSuggestions(suggestions, turboSuggestions));
      return true;
    }

    return false;
  }

  function personalizeReplyText(baseText: string): string {
    if (replyMode === 'concise') {
      const lines = baseText.split('\n').filter((line) => line.trim().length > 0);
      return lines.slice(0, 4).join('\n');
    }

    const hints = [
      '',
      '**Contexto ativo:**',
      `• Área atual: ${currentArea}`,
      `• Modo: ${replyMode === 'detailed' ? 'Detalhado' : 'Curto'}`,
      '• Comandos rápidos: /atalhos, /resumo, /copiar, /limpar',
    ];

    return `${baseText}${hints.join('\n')}`;
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CHATBOT_MODE_KEY);
      if (stored === 'concise' || stored === 'detailed') {
        setReplyMode(stored);
      }
    } catch {
      // Ignore storage issues
    }
  }, []);

  useEffect(() => {
    if (open && !initialised) {
      const restored = restoreMessages();

      if (restored.length > 0) {
        setMessages(restored);
      } else {
        const initialMessage: Message = { id: nextId(), role: 'bot', text: GREETING, timestamp: new Date() };
        setMessages([initialMessage]);
        persistMessages([initialMessage]);
      }

      setFollowupSuggestions(mergeSuggestions(suggestions, turboSuggestions));
      setInitialised(true);
      setUnreadCount(0);
    }
    if (open) {
      setUnreadCount(0);
    }
  }, [GREETING, initialised, open, suggestions, turboSuggestions]);

  useEffect(() => {
    if (!initialised) {
      return;
    }

    persistMessages(messages);
  }, [initialised, messages]);

  useEffect(() => {
    if (!open || !initialised || isTyping) {
      return;
    }

    const nextSuggestions = mergeSuggestions(getInitialSuggestions(ctx), turboSuggestions);
    setFollowupSuggestions((prev) => (sameSuggestions(prev, nextSuggestions) ? prev : nextSuggestions));
  }, [currentUser?.username, hasPermission, initialised, isAccessTotal, isRootAccess, isTyping, location.pathname, open, turboSuggestions, userRole]);

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
    clearConversation();
  }

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (openByShortcut(trimmed)) {
      setInput('');
      return;
    }

    if (handleCommand(trimmed)) {
      setInput('');
      return;
    }

    const userMsg: Message = { id: nextId(), role: 'user', text: trimmed, timestamp: new Date() };
    setMessages((prev) => {
      const next = [...prev, userMsg];
      persistMessages(next);
      return next;
    });
    setInput('');
    setFollowupSuggestions([]);
    setIsTyping(true);

    const delay = 150 + Math.random() * 200;
    setTimeout(() => {
      const reply = resolveAssistantReply(trimmed, ctx);
      const botMsg: Message = {
        id: nextId(),
        role: 'bot',
        text: personalizeReplyText(reply.text),
        timestamp: new Date(),
      };
      setIsTyping(false);
      setMessages((prev) => {
        const next = [...prev, botMsg];
        persistMessages(next);
        return next;
      });
      const resolvedSuggestions = reply.suggestions.length > 0 ? reply.suggestions : getInitialSuggestions(ctx);
      setFollowupSuggestions(mergeSuggestions(resolvedSuggestions, turboSuggestions));
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
            <span className="chatbot-header__title" style={{ flex: 1 }}>
              Assistente Smarter Hub
              <small style={{ display: 'block', fontSize: 11, opacity: 0.88 }}>
                {replyMode === 'detailed' ? 'Modo detalhado' : 'Modo curto'} • {currentArea}
              </small>
            </span>
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
                    onClick={() => {
                      if (!openByShortcut(s)) {
                        sendMessage(s);
                      }
                    }}
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
