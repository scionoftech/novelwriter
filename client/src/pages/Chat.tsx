import { useEffect, useRef, useState } from 'react';
import { api, streamGenerate } from '../api';
import { useNovelStore } from '../store';
import type { Chat, ChatMessage } from '../types';

export default function ChatPage() {
  const { novel } = useNovelStore();
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!novel) return;
    api.listChats(novel.id).then((list) => {
      setChats(list);
      if (list.length && !activeChat) selectChat(list[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel?.id]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const selectChat = async (chat: Chat) => {
    setActiveChat(chat);
    setMessages(await api.getChatMessages(chat.id));
  };

  const newChat = async () => {
    if (!novel) return;
    const chat = await api.createChat(novel.id, `Chat ${chats.length + 1}`);
    setChats([chat, ...chats]);
    setActiveChat(chat);
    setMessages([]);
  };

  const removeChat = async (chat: Chat) => {
    if (!confirm(`Delete "${chat.title}"?`)) return;
    await api.deleteChat(chat.id);
    const list = chats.filter((c) => c.id !== chat.id);
    setChats(list);
    if (activeChat?.id === chat.id) {
      setActiveChat(null);
      setMessages([]);
    }
  };

  const send = async () => {
    if (!novel || !draft.trim() || running) return;
    let chat = activeChat;
    if (!chat) {
      chat = await api.createChat(novel.id, draft.slice(0, 40));
      setChats([chat, ...chats]);
      setActiveChat(chat);
    }
    const text = draft.trim();
    setDraft('');
    setError('');
    setRunning(true);
    setStreaming('');
    setMessages((m) => [
      ...m,
      { id: -Date.now(), chat_id: chat.id, role: 'user', content: text, created_at: '' },
    ]);

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamGenerate(
        { action: 'chat', novelId: novel.id, chatId: chat.id, message: text },
        (delta) => setStreaming((prev) => prev + delta),
        abort.signal
      );
      setMessages(await api.getChatMessages(chat.id));
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      // The server saves a message pair only on success: put the draft back and drop
      // the optimistic message so the UI matches what was stored.
      setDraft((d) => d || text);
      api.getChatMessages(chat.id).then(setMessages).catch(() => undefined);
    } finally {
      setStreaming('');
      setRunning(false);
      abortRef.current = null;
    }
  };

  if (!novel) return null;

  return (
    <div className="h-full flex">
      <aside className="w-64 shrink-0 border-r border-ink-800 overflow-y-auto">
        <div className="p-3 border-b border-ink-800">
          <button className="btn-primary w-full text-xs justify-center" onClick={newChat}>+ New chat</button>
        </div>
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex items-center px-3 py-2 cursor-pointer text-sm ${
              activeChat?.id === chat.id ? 'bg-ink-800 text-ink-100' : 'text-ink-300 hover:bg-ink-850'
            }`}
            onClick={() => selectChat(chat)}
          >
            <span className="flex-1 truncate">{chat.title}</span>
            <button
              className="hidden group-hover:block text-ink-500 hover:text-red-400 px-1"
              onClick={(e) => {
                e.stopPropagation();
                removeChat(chat);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-2xl mx-auto space-y-4">
            {!messages.length && !streaming && (
              <div className="text-center text-ink-500 py-16">
                <p className="text-4xl mb-3">💬</p>
                <p className="text-sm">
                  Brainstorm with an AI that knows your whole story — plot problems, character
                  arcs, what-ifs, next-scene ideas.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex'}>
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user' ? 'bg-accent-600/20 text-ink-100' : 'bg-ink-850 text-ink-200'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {streaming && (
              <div className="flex">
                <div className="max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-ink-850 text-ink-200">
                  {streaming}
                  <span className="animate-pulse">▋</span>
                </div>
              </div>
            )}
            {error && <div className="rounded bg-red-900/40 text-red-200 px-3 py-2 text-xs">{error}</div>}
            <div ref={bottomRef} />
          </div>
        </div>
        <div className="border-t border-ink-800 p-4">
          <div className="max-w-2xl mx-auto flex gap-2">
            <textarea
              className="input min-h-12 max-h-40"
              placeholder="Ask about your story… (Enter to send, Shift+Enter for newline)"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {running ? (
              <button className="btn-danger shrink-0" onClick={() => abortRef.current?.abort()}>■</button>
            ) : (
              <button className="btn-primary shrink-0" onClick={send} disabled={!draft.trim()}>Send</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
