import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

const AUTH_TOKEN_KEY = 'copilot-gateway-token';

export type AuthMethod = 'password' | 'api-key';

export interface LoginCredentials {
  method: AuthMethod;
  /** Email for password-based login */
  email?: string;
  /** Password for password-based login */
  password?: string;
  /** API key for API key-based login */
  apiKey?: string;
}

export interface AuthContextValue {
  /** Whether the user is currently authenticated */
  isAuthenticated: boolean;
  /** Whether authentication status is being checked */
  isLoading: boolean;
  /** Error message from last login attempt */
  error: string | null;
  /** Login with credentials, stores JWT in localStorage on success */
  login: (credentials: LoginCredentials) => Promise<boolean>;
  /** Legacy login with password only (for backwards compatibility) */
  loginWithPassword: (password: string) => Promise<boolean>;
  /** Login with API key */
  loginWithApiKey: (apiKey: string) => Promise<boolean>;
  /** Clear auth token and redirect to login */
  logout: () => void;
  /** Get the stored JWT token */
  getToken: () => string | null;
  /** Clear the current error */
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      // Validate the token by making a test request
      validateToken(token)
        .then((isValid) => {
          setIsAuthenticated(isValid);
          if (!isValid) {
            localStorage.removeItem(AUTH_TOKEN_KEY);
          }
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const login = useCallback(async (credentials: LoginCredentials): Promise<boolean> => {
    setError(null);
    setIsLoading(true);

    try {
      let requestBody: Record<string, string>;

      if (credentials.method === 'api-key') {
        requestBody = { apiKey: credentials.apiKey || '' };
      } else {
        requestBody = {
          email: credentials.email || '',
          password: credentials.password || '',
        };
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const errorMessage = data.error ||
          (credentials.method === 'api-key' ? 'Invalid API key' : 'Invalid email or password');
        setError(errorMessage);
        setIsAuthenticated(false);
        return false;
      }

      const data = await response.json();
      if (data.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        setIsAuthenticated(true);
        return true;
      }

      setError('No token received from server');
      return false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(errorMessage);
      setIsAuthenticated(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loginWithPassword = useCallback(async (password: string): Promise<boolean> => {
    return login({ method: 'password', password });
  }, [login]);

  const loginWithApiKey = useCallback(async (apiKey: string): Promise<boolean> => {
    return login({ method: 'api-key', apiKey });
  }, [login]);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setIsAuthenticated(false);
    setError(null);
  }, []);

  const getToken = useCallback(() => {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }, []);

  const value: AuthContextValue = {
    isAuthenticated,
    isLoading,
    error,
    login,
    loginWithPassword,
    loginWithApiKey,
    logout,
    getToken,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Validate a JWT token by making a test request to the API.
 * Returns true if the token is still valid.
 */
async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await fetch('/api/health', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
