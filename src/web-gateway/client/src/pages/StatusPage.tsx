import { useConnectionStatus } from '@/hooks';

export function StatusPage() {
	const { status, isLoading, error, refresh } = useConnectionStatus();

	return (
		<div className="min-h-screen bg-gray-50 py-8 px-4">
			<div className="max-w-2xl mx-auto">
				<div className="bg-white shadow rounded-lg p-6">
					<div className="flex items-center justify-between mb-6">
						<h1 className="text-2xl font-bold text-gray-900">
							Connection Status
						</h1>
						<button
							onClick={refresh}
							disabled={isLoading}
							className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
						>
							{isLoading ? 'Refreshing...' : 'Refresh'}
						</button>
					</div>

					{error && (
						<div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
							<p className="text-red-700">{error}</p>
						</div>
					)}

					{isLoading && !status && (
						<div className="text-center py-8">
							<p className="text-gray-500">Loading status...</p>
						</div>
					)}

					{status && (
						<div className="space-y-4">
							<div className="flex items-center justify-between py-3 border-b">
								<span className="text-gray-600">Connection</span>
								<span
									className={`flex items-center ${status.connected ? 'text-green-600' : 'text-red-600'
										}`}
								>
									<span
										className={`w-2 h-2 rounded-full mr-2 ${status.connected ? 'bg-green-500' : 'bg-red-500'
											}`}
									/>
									{status.connected ? 'Connected' : 'Disconnected'}
								</span>
							</div>

							{status.vscodeVersion && (
								<div className="flex items-center justify-between py-3 border-b">
									<span className="text-gray-600">VS Code Version</span>
									<span className="text-gray-900">{status.vscodeVersion}</span>
								</div>
							)}

							{status.extensionVersion && (
								<div className="flex items-center justify-between py-3 border-b">
									<span className="text-gray-600">Extension Version</span>
									<span className="text-gray-900">
										{status.extensionVersion}
									</span>
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
