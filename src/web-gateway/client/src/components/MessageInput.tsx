import { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react';

export interface MessageInputProps {
  /** Called when a message is submitted */
  onSend: (message: string) => void;
  /** Whether sending is disabled (e.g., while loading) */
  disabled?: boolean;
  /** Whether a response is currently streaming */
  isStreaming?: boolean;
  /** Called when cancel is clicked during streaming */
  onCancel?: () => void;
  /** Placeholder text */
  placeholder?: string;
}

export function MessageInput({
  onSend,
  disabled = false,
  isStreaming = false,
  onCancel,
  placeholder = 'Type a message...',
}: MessageInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    onSend(input.trim());
    setInput('');

    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const canSend = input.trim().length > 0 && !disabled;

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t bg-white px-4 py-3"
    >
      <div className="max-w-4xl mx-auto flex items-end space-x-3">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
            style={{ minHeight: '48px', maxHeight: '200px' }}
          />
          <div className="absolute bottom-2 right-3 text-xs text-gray-400">
            {input.length > 0 && (
              <span>
                Press Enter to send, Shift+Enter for new line
              </span>
            )}
          </div>
        </div>

        {isStreaming ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
            title="Cancel response"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Send message"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
