import { useRef, useEffect } from 'react';
import { ChatMessage } from '@/api';

export interface MessageListProps {
  /** Messages to display */
  messages: ChatMessage[];
  /** Content currently being streamed (for the assistant) */
  streamingContent?: string;
  /** Whether a response is being loaded */
  isLoading?: boolean;
}

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-3xl px-4 py-3 rounded-lg ${
          isUser
            ? 'bg-primary-600 text-white'
            : 'bg-white text-gray-900 shadow-sm border border-gray-100'
        }`}
      >
        {!isUser && (
          <div className="flex items-center mb-1">
            <span className="text-xs font-medium text-primary-600">
              Copilot
            </span>
            {isStreaming && (
              <span className="ml-2 flex items-center">
                <span className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" />
              </span>
            )}
          </div>
        )}
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
          {message.content}
        </pre>
      </div>
    </div>
  );
}

function StreamingMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-3xl px-4 py-3 rounded-lg bg-white text-gray-900 shadow-sm border border-gray-100">
        <div className="flex items-center mb-1">
          <span className="text-xs font-medium text-primary-600">Copilot</span>
          <span className="ml-2 flex items-center">
            <span className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" />
          </span>
        </div>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
          {content}
          <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
        </pre>
      </div>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-white text-gray-500 px-4 py-3 rounded-lg shadow-sm border border-gray-100">
        <div className="flex items-center space-x-2">
          <div className="flex space-x-1">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-sm">Thinking...</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <div className="w-16 h-16 mb-4 rounded-full bg-primary-100 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-primary-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        Start a conversation
      </h3>
      <p className="text-gray-500 max-w-sm">
        Ask Copilot anything about your code, get help with debugging, or explore new ideas.
      </p>
    </div>
  );
}

export function MessageList({
  messages,
  streamingContent,
  isLoading,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent]);

  const hasMessages = messages.length > 0 || streamingContent;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {!hasMessages ? (
        <EmptyState />
      ) : (
        <div className="space-y-4 max-w-4xl mx-auto">
          {messages.map((message, index) => (
            <MessageBubble key={message.id || index} message={message} />
          ))}
          {streamingContent && <StreamingMessage content={streamingContent} />}
          {isLoading && !streamingContent && <LoadingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}
