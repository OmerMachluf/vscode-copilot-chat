import { useState, useEffect, useCallback } from 'react';
import { apiClient, ConnectionStatus } from '@/api';

export interface UseConnectionStatusResult {
	status: ConnectionStatus | null;
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}

export function useConnectionStatus(
	pollInterval?: number
): UseConnectionStatusResult {
	const [status, setStatus] = useState<ConnectionStatus | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchStatus = useCallback(async () => {
		try {
			const result = await apiClient.getConnectionStatus();
			setStatus(result);
			setError(null);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : 'Failed to get connection status';
			setError(message);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchStatus();

		if (pollInterval && pollInterval > 0) {
			const intervalId = setInterval(fetchStatus, pollInterval);
			return () => clearInterval(intervalId);
		}
	}, [fetchStatus, pollInterval]);

	return {
		status,
		isLoading,
		error,
		refresh: fetchStatus,
	};
}
