import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth, useConnectionStatus } from '@/hooks';

interface LayoutProps {
	children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
	const location = useLocation();
	const { logout } = useAuth();
	const { status, refresh } = useConnectionStatus(30000); // Poll every 30 seconds
	const [showMobileMenu, setShowMobileMenu] = useState(false);

	const navItems = [
		{ path: '/', label: 'Chat', icon: 'chat' },
		{ path: '/orchestrator', label: 'Orchestrator', icon: 'orchestrator' },
		{ path: '/settings', label: 'Settings', icon: 'settings' },
	];

	const getIcon = (icon: string) => {
		switch (icon) {
			case 'chat':
				return (
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
					</svg>
				);
			case 'orchestrator':
				return (
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
					</svg>
				);
			case 'settings':
				return (
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
				);
			default:
				return null;
		}
	};

	return (
		<div className="min-h-screen bg-gray-50">
			{/* Navigation */}
			<nav className="bg-white shadow-sm sticky top-0 z-40">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="flex justify-between h-14">
						<div className="flex items-center">
							{/* Logo */}
							<Link to="/" className="flex items-center gap-2">
								<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
									<svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2L2 7l10 5 10-5-10-5z" />
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 17l10 5 10-5" />
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 12l10 5 10-5" />
									</svg>
								</div>
								<span className="text-lg font-semibold text-gray-900 hidden sm:block">
									Copilot Gateway
								</span>
							</Link>

							{/* Desktop Navigation */}
							<div className="hidden md:flex ml-8 space-x-1">
								{navItems.map((item) => (
									<Link
										key={item.path}
										to={item.path}
										className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
											location.pathname === item.path
												? 'bg-primary-100 text-primary-700'
												: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
										}`}
									>
										{getIcon(item.icon)}
										{item.label}
									</Link>
								))}
							</div>
						</div>

						{/* Right side */}
						<div className="flex items-center gap-3">
							{/* Connection Status */}
							<button
								onClick={refresh}
								className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
								title={status?.connected ? 'Connected to VS Code' : 'Disconnected'}
							>
								<span
									className={`w-2 h-2 rounded-full ${
										status?.connected ? 'bg-green-500' : 'bg-red-500'
									}`}
								/>
								<span className="text-xs text-gray-500 hidden sm:block">
									{status?.connected ? 'Connected' : 'Disconnected'}
								</span>
							</button>

							{/* User Menu */}
							<div className="hidden sm:flex items-center gap-2 border-l pl-3">
								<button
									onClick={logout}
									className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
								>
									<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
									</svg>
									Sign out
								</button>
							</div>

							{/* Mobile menu button */}
							<button
								onClick={() => setShowMobileMenu(!showMobileMenu)}
								className="md:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
							>
								<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									{showMobileMenu ? (
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
									) : (
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
									)}
								</svg>
							</button>
						</div>
					</div>
				</div>

				{/* Mobile menu */}
				{showMobileMenu && (
					<div className="md:hidden border-t border-gray-200 bg-white">
						<div className="px-2 pt-2 pb-3 space-y-1">
							{navItems.map((item) => (
								<Link
									key={item.path}
									to={item.path}
									onClick={() => setShowMobileMenu(false)}
									className={`flex items-center gap-2 px-3 py-2 rounded-md text-base font-medium ${
										location.pathname === item.path
											? 'bg-primary-100 text-primary-700'
											: 'text-gray-600 hover:bg-gray-100'
									}`}
								>
									{getIcon(item.icon)}
									{item.label}
								</Link>
							))}
							<button
								onClick={() => {
									logout();
									setShowMobileMenu(false);
								}}
								className="flex items-center gap-2 w-full px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-100 rounded-md"
							>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
								</svg>
								Sign out
							</button>
						</div>
					</div>
				)}
			</nav>

			{/* Main content */}
			<main>{children}</main>
		</div>
	);
}
