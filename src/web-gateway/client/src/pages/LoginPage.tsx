import { useState, useCallback, useEffect, FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth, AuthMethod } from '../hooks/useAuth';

interface FormErrors {
  email?: string;
  password?: string;
  apiKey?: string;
}

function validateEmail(email: string): string | undefined {
  if (!email.trim()) {
    return 'Email is required';
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Please enter a valid email address';
  }
  return undefined;
}

function validatePassword(password: string): string | undefined {
  if (!password) {
    return 'Password is required';
  }
  if (password.length < 6) {
    return 'Password must be at least 6 characters';
  }
  return undefined;
}

function validateApiKey(apiKey: string): string | undefined {
  if (!apiKey.trim()) {
    return 'API key is required';
  }
  if (apiKey.trim().length < 16) {
    return 'API key must be at least 16 characters';
  }
  return undefined;
}

export function LoginPage() {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [showApiKey, setShowApiKey] = useState(false);

  const { isAuthenticated, isLoading, error, login, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get the redirect path from location state, default to /chat
  const from = (location.state as { from?: string })?.from || '/chat';

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, from]);

  // Clear server error when switching auth methods
  useEffect(() => {
    clearError();
    setFormErrors({});
  }, [authMethod, clearError]);

  const validateForm = useCallback((): boolean => {
    const errors: FormErrors = {};

    if (authMethod === 'password') {
      const emailError = validateEmail(email);
      const passwordError = validatePassword(password);
      if (emailError) errors.email = emailError;
      if (passwordError) errors.password = passwordError;
    } else {
      const apiKeyError = validateApiKey(apiKey);
      if (apiKeyError) errors.apiKey = apiKeyError;
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [authMethod, email, password, apiKey]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    let success: boolean;
    if (authMethod === 'password') {
      success = await login({ method: 'password', email, password });
    } else {
      success = await login({ method: 'api-key', apiKey });
    }

    if (success) {
      navigate(from, { replace: true });
    }
  }, [authMethod, email, password, apiKey, login, navigate, from, validateForm]);

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (formErrors.email) {
      setFormErrors(prev => ({ ...prev, email: undefined }));
    }
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (formErrors.password) {
      setFormErrors(prev => ({ ...prev, password: undefined }));
    }
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    if (formErrors.apiKey) {
      setFormErrors(prev => ({ ...prev, apiKey: undefined }));
    }
  };

  // Show loading state while checking existing auth
  if (isLoading && !email && !password && !apiKey) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-loading">
            <div className="spinner" />
            <span>Checking authentication...</span>
          </div>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1>Copilot Gateway</h1>
          <p>Sign in to access your AI assistant</p>
        </div>

        {/* Auth Method Tabs */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${authMethod === 'password' ? 'active' : ''}`}
            onClick={() => setAuthMethod('password')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Email & Password
          </button>
          <button
            type="button"
            className={`auth-tab ${authMethod === 'api-key' ? 'active' : ''}`}
            onClick={() => setAuthMethod('api-key')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            API Key
          </button>
        </div>

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          {authMethod === 'password' ? (
            <>
              <div className={`form-group ${formErrors.email ? 'has-error' : ''}`}>
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  disabled={isLoading}
                  aria-invalid={!!formErrors.email}
                  aria-describedby={formErrors.email ? 'email-error' : undefined}
                />
                {formErrors.email && (
                  <span id="email-error" className="field-error" role="alert">
                    {formErrors.email}
                  </span>
                )}
              </div>

              <div className={`form-group ${formErrors.password ? 'has-error' : ''}`}>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={isLoading}
                  aria-invalid={!!formErrors.password}
                  aria-describedby={formErrors.password ? 'password-error' : undefined}
                />
                {formErrors.password && (
                  <span id="password-error" className="field-error" role="alert">
                    {formErrors.password}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className={`form-group ${formErrors.apiKey ? 'has-error' : ''}`}>
              <label htmlFor="apiKey">API Key</label>
              <div className="input-with-toggle">
                <input
                  id="apiKey"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder="Enter your API key"
                  autoComplete="off"
                  autoFocus
                  disabled={isLoading}
                  aria-invalid={!!formErrors.apiKey}
                  aria-describedby={formErrors.apiKey ? 'apikey-error' : undefined}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowApiKey(!showApiKey)}
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              {formErrors.apiKey && (
                <span id="apikey-error" className="field-error" role="alert">
                  {formErrors.apiKey}
                </span>
              )}
              <span className="field-hint">
                Your API key should be kept secure and never shared publicly.
              </span>
            </div>
          )}

          {error && (
            <div className="error-message" role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner-small" />
                Signing in...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                Sign In
              </>
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>
            {authMethod === 'password'
              ? "Don't have an account? Contact your administrator."
              : 'Get your API key from the admin settings.'}
          </p>
        </div>
      </div>
      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .login-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
    padding: 1rem;
    position: relative;
    overflow: hidden;
  }

  .login-container::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background:
      radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(139, 92, 246, 0.15) 0%, transparent 50%);
    pointer-events: none;
  }

  .login-card {
    background: rgba(255, 255, 255, 0.98);
    border-radius: 16px;
    box-shadow:
      0 25px 50px -12px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.1);
    padding: 2.5rem;
    width: 100%;
    max-width: 420px;
    position: relative;
    z-index: 1;
  }

  .login-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .login-logo {
    width: 56px;
    height: 56px;
    margin: 0 auto 1rem;
    background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  .login-logo svg {
    width: 28px;
    height: 28px;
    color: white;
  }

  .login-header h1 {
    margin: 0 0 0.5rem;
    font-size: 1.75rem;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.02em;
  }

  .login-header p {
    margin: 0;
    color: #64748b;
    font-size: 0.95rem;
  }

  .auth-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    padding: 0.25rem;
    background: #f1f5f9;
    border-radius: 10px;
  }

  .auth-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border: none;
    background: transparent;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    color: #64748b;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .auth-tab svg {
    width: 16px;
    height: 16px;
  }

  .auth-tab:hover {
    color: #3b82f6;
  }

  .auth-tab.active {
    background: white;
    color: #3b82f6;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .login-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-weight: 500;
    color: #334155;
    font-size: 0.875rem;
  }

  .form-group input {
    padding: 0.875rem 1rem;
    border: 2px solid #e2e8f0;
    border-radius: 10px;
    font-size: 1rem;
    transition: all 0.2s ease;
    background: white;
  }

  .form-group input::placeholder {
    color: #94a3b8;
  }

  .form-group input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .form-group input:disabled {
    background: #f8fafc;
    cursor: not-allowed;
    opacity: 0.7;
  }

  .form-group.has-error input {
    border-color: #ef4444;
  }

  .form-group.has-error input:focus {
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
  }

  .input-with-toggle {
    position: relative;
    display: flex;
    align-items: center;
  }

  .input-with-toggle input {
    flex: 1;
    padding-right: 3rem;
  }

  .toggle-visibility {
    position: absolute;
    right: 0.75rem;
    padding: 0.5rem;
    border: none;
    background: transparent;
    cursor: pointer;
    color: #64748b;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s;
  }

  .toggle-visibility:hover {
    color: #3b82f6;
  }

  .toggle-visibility svg {
    width: 20px;
    height: 20px;
  }

  .field-error {
    color: #ef4444;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .field-hint {
    color: #64748b;
    font-size: 0.8rem;
    margin-top: 0.25rem;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    padding: 0.875rem 1rem;
    border-radius: 10px;
    font-size: 0.9rem;
  }

  .error-message svg {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
  }

  .login-button {
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: white;
    border: none;
    border-radius: 10px;
    padding: 1rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  .login-button svg {
    width: 20px;
    height: 20px;
  }

  .login-button:hover:not(:disabled) {
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
  }

  .login-button:active:not(:disabled) {
    transform: translateY(0);
  }

  .login-button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .login-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem;
    color: #64748b;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .spinner-small {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .login-footer {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid #e2e8f0;
    text-align: center;
  }

  .login-footer p {
    margin: 0;
    color: #64748b;
    font-size: 0.875rem;
  }

  @media (max-width: 480px) {
    .login-card {
      padding: 1.5rem;
    }

    .login-header h1 {
      font-size: 1.5rem;
    }

    .auth-tab {
      padding: 0.625rem 0.75rem;
      font-size: 0.8rem;
    }

    .auth-tab svg {
      width: 14px;
      height: 14px;
    }
  }
`;
