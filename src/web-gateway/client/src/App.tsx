import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout, ProtectedRoute } from '@/components';
import { LoginPage, ChatPage, StatusPage, OrchestratorPage, SettingsPage } from '@/pages';
import { useAuth } from '@/hooks';

function AppRoutes() {
	const { isAuthenticated } = useAuth();

	return (
		<Routes>
			<Route
				path="/login"
				element={
					isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
				}
			/>
			<Route
				path="/"
				element={
					<ProtectedRoute>
						<Layout>
							<ChatPage />
						</Layout>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/status"
				element={
					<ProtectedRoute>
						<Layout>
							<StatusPage />
						</Layout>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/orchestrator"
				element={
					<ProtectedRoute>
						<Layout>
							<OrchestratorPage />
						</Layout>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/settings"
				element={
					<ProtectedRoute>
						<Layout>
							<SettingsPage />
						</Layout>
					</ProtectedRoute>
				}
			/>
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}

export function App() {
	return (
		<BrowserRouter>
			<AppRoutes />
		</BrowserRouter>
	);
}
