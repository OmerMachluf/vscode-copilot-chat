const AUTH_TOKEN_KEY = 'copilot-gateway-token';

export interface ApiError {
  error: string;
  status: number;
}

export interface ApiClientOptions {
  /** Base URL for API requests (defaults to current origin) */
  baseUrl?: string;
}

/** Chat message role */
export type ChatRole = 'user' | 'assistant' | 'system';

/** Chat message structure */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  id?: string;
  timestamp?: number;
}

/** Chat request payload */
export interface ChatRequest {
  message: string;
  sessionId?: string;
}

/** Chat response from non-streaming endpoint */
export interface ChatResponse {
  message: ChatMessage;
  sessionId: string;
}

/** SSE event types for streaming chat */
export type ChatStreamEventType = 'start' | 'content' | 'done' | 'error';

/** SSE event data for streaming chat */
export interface ChatStreamEvent {
  type: ChatStreamEventType;
  content?: string;
  messageId?: string;
  error?: string;
}

/** Connection status from the extension */
export interface ConnectionStatus {
  connected: boolean;
  vscodeVersion?: string;
  extensionVersion?: string;
}

/**
 * API client for the Copilot Gateway.
 * Automatically includes auth token in requests.
 */
export class ApiClient {
  private readonly baseUrl: string;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl || '';
  }

  /**
   * Get the stored JWT token from localStorage.
   */
  getToken(): string | null {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  /**
   * Set the JWT token in localStorage.
   */
  setToken(token: string): void {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }

  /**
   * Clear the stored JWT token.
   */
  clearToken(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  /**
   * Check if a token is stored.
   */
  hasToken(): boolean {
    return this.getToken() !== null;
  }

  /**
   * Make an authenticated API request.
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers = new Headers(options.headers || {});

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      // Handle 401 by clearing token
      if (response.status === 401) {
        this.clearToken();
      }

      let errorMessage = 'Request failed';
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }

      const error: ApiError = {
        error: errorMessage,
        status: response.status,
      };
      throw error;
    }

    // Handle empty responses
    const contentType = response.headers.get('Content-Type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }

    return undefined as unknown as T;
  }

  /**
   * GET request helper.
   */
  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * POST request helper.
   */
  async post<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * PUT request helper.
   */
  async put<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * DELETE request helper.
   */
  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /**
   * Create an EventSource for Server-Sent Events with auth.
   * Note: Standard EventSource doesn't support custom headers,
   * so we use fetch with streaming for authenticated SSE.
   */
  async streamSSE(
    endpoint: string,
    onMessage: (data: unknown) => void,
    onError?: (error: Error) => void
  ): Promise<AbortController> {
    const controller = new AbortController();
    const token = this.getToken();

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const text = decoder.decode(value, { stream: true });
              const lines = text.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    onMessage(data);
                  } catch {
                    // Ignore parse errors for partial data
                  }
                }
              }
            }
          } catch (err) {
            if (err instanceof Error && err.name !== 'AbortError') {
              onError?.(err);
            }
          }
        };

        processStream();
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        onError?.(err);
      }
    }

    return controller;
  }
}

// Singleton instance for convenience
export const api = new ApiClient();

/**
 * Extended API client with domain-specific methods for chat and status.
 */
class GatewayApiClient extends ApiClient {
  /**
   * Send a chat message (non-streaming).
   */
  async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    return this.post<ChatResponse>('/api/chat', request);
  }

  /**
   * Send a chat message with streaming response.
   * Returns an abort controller to cancel the stream.
   */
  async sendMessageStream(
    request: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
    onError?: (error: Error) => void,
  ): Promise<AbortController> {
    const controller = new AbortController();
    const token = this.getToken();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat stream failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6)) as ChatStreamEvent;
                    onEvent(data);
                  } catch {
                    // Ignore parse errors for partial data
                  }
                }
              }
            }
          } catch (err) {
            if (err instanceof Error && err.name !== 'AbortError') {
              onError?.(err);
            }
          }
        };

        processStream();
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        onError?.(err);
      }
    }

    return controller;
  }

  /**
   * Get the connection status to VS Code extension.
   */
  async getConnectionStatus(): Promise<ConnectionStatus> {
    return this.get<ConnectionStatus>('/api/status');
  }
}

// Singleton instance with domain methods
export const apiClient = new GatewayApiClient();
