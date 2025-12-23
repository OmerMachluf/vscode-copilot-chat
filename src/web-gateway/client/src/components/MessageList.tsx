import { useRef, useEffect, memo } from 'react';
import { ChatMessage } from '@/api';
import { MarkdownRenderer } from './MarkdownRenderer';

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

const MessageBubble = memo(function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isError = message.content.startsWith('Error:');

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-3xl px-4 py-3 rounded-lg ${
          isUser
            ? 'bg-primary-600 text-white'
            : isError
              ? 'bg-red-50 text-red-900 shadow-sm border border-red-200'
              : 'bg-white text-gray-900 shadow-sm border border-gray-100'
        }`}
      >
        {!isUser && (
          <div className="flex items-center mb-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
              isError ? 'bg-red-100' : 'bg-primary-100'
            }`}>
              {isError ? (
                <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <span className={`ml-2 text-xs font-medium ${isError ? 'text-red-600' : 'text-primary-600'}`}>
              Copilot
            </span>
            {isStreaming && (
              <span className="ml-2 flex items-center">
                <span className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" />
              </span>
            )}
          </div>
        )}
        {isUser ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {message.content}
          </pre>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
        {message.timestamp && (
          <div className={`mt-2 text-xs ${isUser ? 'text-primary-200' : 'text-gray-400'}`}>
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
});

const StreamingMessage = memo(function StreamingMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-3xl px-4 py-3 rounded-lg bg-white text-gray-900 shadow-sm border border-gray-100">
        <div className="flex items-center mb-2">
          <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="ml-2 text-xs font-medium text-primary-600">Copilot</span>
          <span className="ml-2 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" />
            <span className="text-xs text-gray-400">Streaming...</span>
          </span>
        </div>
        <MarkdownRenderer content={content} />
        <span className="inline-block w-2 h-4 bg-primary-400 animate-pulse ml-0.5 rounded-sm" />
      </div>
    </div>
  );
});

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
