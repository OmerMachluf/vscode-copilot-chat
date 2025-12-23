import rateLimit, { RateLimitRequestHandler, Options } from 'express-rate-limit';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from './auth';

/**
 * Rate limiting configuration.
 * These values can be overridden via environment variables.
 */
export interface RateLimitConfig {
	/** Global requests per minute per IP (default: 1000) */
	globalPerMinute: number;
	/** Chat requests per minute per user (default: 10) */
	chatPerMinute: number;
	/** Launcher requests per minute per user (default: 5) */
	launcherPerMinute: number;
	/** Session requests per minute per user (default: 30) */
	sessionPerMinute: number;
}

/**
 * Default rate limit configuration.
 */
function getDefaultConfig(): RateLimitConfig {
	return {
		globalPerMinute: parseInt(process.env.RATE_LIMIT_GLOBAL_PER_MIN ?? '1000', 10),
		chatPerMinute: parseInt(process.env.RATE_LIMIT_CHAT_PER_MIN ?? '10', 10),
		launcherPerMinute: parseInt(process.env.RATE_LIMIT_LAUNCHER_PER_MIN ?? '5', 10),
		sessionPerMinute: parseInt(process.env.RATE_LIMIT_SESSION_PER_MIN ?? '30', 10),
	};
}

/**
 * Standard rate limit error response.
 */
const rateLimitMessage = {
	error: {
		code: 'RATE_LIMIT_EXCEEDED',
		message: 'Too many requests, please try again later.',
	},
};

/**
 * Get the client IP address for rate limiting.
 * Handles proxied requests by checking X-Forwarded-For header.
 */
function getClientIp(req: Request): string {
	// Trust proxy headers (should be configured via app.set('trust proxy', ...))
	const forwarded = req.headers['x-forwarded-for'];
	if (forwarded) {
		const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
		return ips.trim();
	}
	return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Get the user identifier for per-user rate limiting.
 * Falls back to IP address if user is not authenticated.
 */
function getUserIdentifier(req: AuthenticatedRequest): string {
	if (req.user?.sub) {
		return `user:${req.user.sub}`;
	}
	return `ip:${getClientIp(req)}`;
}

/**
 * Create a rate limiter with common options.
 */
function createLimiter(options: Partial<Options>): RateLimitRequestHandler {
	return rateLimit({
		standardHeaders: true, // Return rate limit info in RateLimit-* headers
		legacyHeaders: false, // Disable X-RateLimit-* headers
		message: rateLimitMessage,
		handler: (req: Request, res: Response) => {
			res.status(429).json(rateLimitMessage);
		},
		...options,
	});
}

/**
 * Global rate limiter: 1000 requests per minute per IP.
 *
 * This limiter applies to all incoming requests and helps protect
 * against DDoS attacks and general abuse.
 */
export function createGlobalRateLimiter(config?: Partial<RateLimitConfig>): RateLimitRequestHandler {
	const { globalPerMinute } = { ...getDefaultConfig(), ...config };

	return createLimiter({
		windowMs: 60 * 1000, // 1 minute
		max: globalPerMinute,
		keyGenerator: (req: Request) => getClientIp(req),
		skip: (req: Request) => {
			// Skip rate limiting for health checks
			return req.path === '/health';
		},
	});
}

/**
 * Chat rate limiter: 10 requests per minute per user.
 *
 * This limiter applies to chat-related endpoints to prevent
 * abuse of the AI chat functionality.
 */
export function createChatRateLimiter(config?: Partial<RateLimitConfig>): RateLimitRequestHandler {
	const { chatPerMinute } = { ...getDefaultConfig(), ...config };

	return createLimiter({
		windowMs: 60 * 1000, // 1 minute
		max: chatPerMinute,
		keyGenerator: (req: Request) => getUserIdentifier(req as AuthenticatedRequest),
		message: {
			error: {
				code: 'CHAT_RATE_LIMIT_EXCEEDED',
				message: 'Chat rate limit exceeded. Please wait before sending more messages.',
			},
		},
	});
}

/**
 * Launcher rate limiter: 5 requests per minute per user.
 *
 * This limiter applies to launcher endpoints to prevent
 * excessive spawning of processes or sessions.
 */
export function createLauncherRateLimiter(config?: Partial<RateLimitConfig>): RateLimitRequestHandler {
	const { launcherPerMinute } = { ...getDefaultConfig(), ...config };

	return createLimiter({
		windowMs: 60 * 1000, // 1 minute
		max: launcherPerMinute,
		keyGenerator: (req: Request) => getUserIdentifier(req as AuthenticatedRequest),
		message: {
			error: {
				code: 'LAUNCHER_RATE_LIMIT_EXCEEDED',
				message: 'Launcher rate limit exceeded. Please wait before launching more sessions.',
			},
		},
	});
}

/**
 * Session rate limiter: 30 requests per minute per user.
 *
 * This limiter applies to session management endpoints to prevent
 * excessive session creation and management operations.
 */
export function createSessionRateLimiter(config?: Partial<RateLimitConfig>): RateLimitRequestHandler {
	const { sessionPerMinute } = { ...getDefaultConfig(), ...config };

	return createLimiter({
		windowMs: 60 * 1000, // 1 minute
		max: sessionPerMinute,
		keyGenerator: (req: Request) => getUserIdentifier(req as AuthenticatedRequest),
		message: {
			error: {
				code: 'SESSION_RATE_LIMIT_EXCEEDED',
				message: 'Session rate limit exceeded. Please wait before making more session requests.',
			},
		},
	});
}

/**
 * Pre-configured rate limiters using default configuration.
 * These can be used directly in route handlers.
 */
export const globalRateLimiter = createGlobalRateLimiter();
export const chatRateLimiter = createChatRateLimiter();
export const launcherRateLimiter = createLauncherRateLimiter();
export const sessionRateLimiter = createSessionRateLimiter();

/**
 * Rate limit configuration for reference.
 */
export const rateLimitConfig = getDefaultConfig();
