import { useState, useCallback, useRef } from 'react';
import { apiClient, ChatMessage, ChatStreamEvent } from '@/api';

export interface UseChatOptions {
  /** Enable streaming responses (default: true) */
  streaming?: boolean;
  /** Session ID for continuing a conversation */
  sessionId?: string;
  /** Callback when a new message is received */
  onMessage?: (message: ChatMessage) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
}

export interface UseChatResult {
  /** All messages in the conversation */
  messages: ChatMessage[];
  /** Current streaming content (before message is complete) */
  streamingContent: string;
  /** Whether a message is currently being sent/received */
  isLoading: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Send a new message */
  sendMessage: (content: string) => Promise<void>;
  /** Clear all messages */
  clearMessages: () => void;
  /** Cancel the current streaming response */
  cancelStream: () => void;
}

/**
 * Hook for managing chat interactions with the Copilot gateway.
 * Supports both streaming and non-streaming responses.
 */
export function useChat(options: UseChatOptions = {}): UseChatResult {
  const { streaming = true, sessionId, onMessage, onError } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentSessionId = useRef<string | undefined>(sessionId);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setStreamingContent('');
    setError(null);
  }, []);

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setStreamingContent('');
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      // Add user message immediately
      const userMessage: ChatMessage = {
        role: 'user',
        content: content.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setError(null);
      setIsLoading(true);
      setStreamingContent('');

      try {
        if (streaming) {
          // Streaming response
          let accumulatedContent = '';

          const handleEvent = (event: ChatStreamEvent) => {
            switch (event.type) {
              case 'start':
                accumulatedContent = '';
                setStreamingContent('');
                break;

              case 'content':
                if (event.content) {
                  accumulatedContent += event.content;
                  setStreamingContent(accumulatedContent);
                }
                break;

              case 'done': {
                const assistantMessage: ChatMessage = {
                  role: 'assistant',
                  content: accumulatedContent,
                  id: event.messageId,
                  timestamp: Date.now(),
                };
                setMessages((prev) => [...prev, assistantMessage]);
                setStreamingContent('');
                setIsLoading(false);
                onMessage?.(assistantMessage);
                break;
              }

              case 'error':
                throw new Error(event.error || 'Stream error');
            }
          };

          const handleError = (err: Error) => {
            const errorMsg = err.message || 'Failed to get response';
            setError(errorMsg);
            setIsLoading(false);
            setStreamingContent('');
            onError?.(err);
          };

          abortControllerRef.current = await apiClient.sendMessageStream(
            { message: content, sessionId: currentSessionId.current },
            handleEvent,
            handleError,
          );
        } else {
          // Non-streaming response
          const response = await apiClient.sendMessage({
            message: content,
            sessionId: currentSessionId.current,
          });

          currentSessionId.current = response.sessionId;

          const assistantMessage: ChatMessage = {
            ...response.message,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setIsLoading(false);
          onMessage?.(assistantMessage);
        }
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMsg);
        setIsLoading(false);
        setStreamingContent('');

        // Add error as assistant message for visibility
        const errorMessage: ChatMessage = {
          role: 'assistant',
          content: `Error: ${errorMsg}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);

        if (err instanceof Error) {
          onError?.(err);
        }
      }
    },
    [isLoading, streaming, onMessage, onError],
  );

  return {
    messages,
    streamingContent,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    cancelStream,
  };
}
