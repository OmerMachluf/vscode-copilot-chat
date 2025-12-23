/**
 * Proxy module exports
 */

export {
	createApiProxy,
	createApiProxyRouter,
	checkExtensionAvailability,
	extensionHealthCheck,
	API_PROXY_CONFIG,
	type ApiProxyConfig,
} from './apiProxy';

export {
	createSSEHandler,
	createHealthAwareSSEHandler,
	sseDetectorMiddleware,
	closeAllSSEConnections,
	getActiveSSEConnections,
	getSSETimeout,
	isChatRoute,
	DEFAULT_SSE_TIMEOUTS,
	type SSEHandlerConfig,
	type SSETimeoutConfig,
} from './sseHandler';
