import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks';

interface LayoutProps {
	children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
	const location = useLocation();
	const { logout } = useAuth();

	const navItems = [
		{ path: '/', label: 'Chat' },
		{ path: '/status', label: 'Status' },
	];

	return (
		<div className="min-h-screen bg-gray-50">
			{/* Navigation */}
			<nav className="bg-white shadow-sm">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="flex justify-between h-14">
						<div className="flex items-center">
							<span className="text-lg font-semibold text-primary-600">
								Copilot Gateway
							</span>
							<div className="ml-8 flex space-x-4">
								{navItems.map((item) => (
									<Link
										key={item.path}
										to={item.path}
										className={`px-3 py-2 rounded-md text-sm font-medium ${location.pathname === item.path ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
									>
										{item.label}
									</Link>
								))}
							</div>
						</div>
						<div className="flex items-center">
							<button
								onClick={logout}
								className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
							>
								Sign out
							</button>
						</div>
					</div>
				</div>
			</nav>

			{/* Main content */}
			<main>{children}</main>
		</div>
	);
}
