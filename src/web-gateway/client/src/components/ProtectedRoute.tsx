import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export interface ProtectedRouteProps {
  children: ReactNode;
  /** Optional custom redirect path (defaults to /login) */
  redirectTo?: string;
}

/**
 * A wrapper component that protects routes from unauthenticated access.
 * Redirects to login page if user is not authenticated.
 * Preserves the attempted URL so user can be redirected back after login.
 */
export function ProtectedRoute({ children, redirectTo = '/login' }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="protected-route-loading">
        <div className="spinner" />
        <style>{`
          .protected-route-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f5f5f5;
          }

          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid #e1e1e1;
            border-top-color: #4a90d9;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }

          @keyframes spin {
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    // Store the attempted URL so we can redirect back after login
    return (
      <Navigate
        to={redirectTo}
        state={{ from: location.pathname }}
        replace
      />
    );
  }

  // Render the protected content
  return <>{children}</>;
}
