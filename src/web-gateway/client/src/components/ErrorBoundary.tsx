/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
	onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
	errorInfo: ErrorInfo | null;
}

/**
 * Error boundary component that catches JavaScript errors anywhere in the child
 * component tree and displays a fallback UI instead of crashing.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = {
			hasError: false,
			error: null,
			errorInfo: null,
		};
	}

	static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		this.setState({ errorInfo });
		this.props.onError?.(error, errorInfo);

		// Log error to console in development
		if (import.meta.env.DEV) {
			console.error('ErrorBoundary caught an error:', error, errorInfo);
		}
	}

	handleRetry = (): void => {
		this.setState({
			hasError: false,
			error: null,
			errorInfo: null,
		});
	};

	render(): ReactNode {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			return (
				<div className="min-h-[400px] flex items-center justify-center p-8">
					<div className="max-w-md w-full bg-white rounded-lg shadow-lg border border-red-100 p-6">
						<div className="flex items-center gap-3 mb-4">
							<div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
								<svg
									className="w-5 h-5 text-red-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
									/>
								</svg>
							</div>
							<div>
								<h3 className="text-lg font-semibold text-gray-900">
									Something went wrong
								</h3>
								<p className="text-sm text-gray-500">
									An unexpected error occurred
								</p>
							</div>
						</div>

						{this.state.error && (
							<div className="mb-4 p-3 bg-red-50 rounded-lg">
								<p className="text-sm text-red-700 font-mono">
									{this.state.error.message}
								</p>
							</div>
						)}

						{import.meta.env.DEV && this.state.errorInfo && (
							<details className="mb-4">
								<summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-800">
									Show stack trace
								</summary>
								<pre className="mt-2 p-3 bg-gray-100 rounded-lg text-xs text-gray-700 overflow-x-auto max-h-48 overflow-y-auto">
									{this.state.errorInfo.componentStack}
								</pre>
							</details>
						)}

						<div className="flex gap-3">
							<button
								onClick={this.handleRetry}
								className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors"
							>
								Try Again
							</button>
							<button
								onClick={() => window.location.reload()}
								className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
							>
								Reload Page
							</button>
						</div>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
