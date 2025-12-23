import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

/**
 * User payload stored in the JWT token.
 */
export interface JwtPayload {
	/** User identifier (email or 'api-key-user' for API key auth) */
	sub: string;
	/** Authentication method used */
	method: 'password' | 'api-key';
	/** Token issued at timestamp */
	iat?: number;
	/** Token expiration timestamp */
	exp?: number;
}

/**
 * Extended Express Request with user information.
 */
export interface AuthenticatedRequest extends Request {
	user?: JwtPayload;
}

/**
 * Generate a JWT token for a user.
 */
export function generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
	// Parse expiresIn to seconds if it's a string like '24h'
	const expiresIn = parseExpiresIn(config.jwtExpiresIn);
	return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

/**
 * Parse expiration string to seconds.
 * Supports formats like '24h', '7d', '1w', or numeric seconds.
 */
function parseExpiresIn(value: string): number {
	const match = value.match(/^(\d+)([smhdw]?)$/);
	if (!match) {
		// Default to 24 hours if invalid
		return 86400;
	}

	const num = parseInt(match[1], 10);
	const unit = match[2] || 's';

	switch (unit) {
		case 's': return num;
		case 'm': return num * 60;
		case 'h': return num * 3600;
		case 'd': return num * 86400;
		case 'w': return num * 604800;
		default: return num;
	}
}

/**
 * Verify and decode a JWT token.
 * Returns the payload if valid, null if invalid.
 */
export function verifyToken(token: string): JwtPayload | null {
	try {
		return jwt.verify(token, config.jwtSecret) as JwtPayload;
	} catch {
		return null;
	}
}

/**
 * Middleware to require authentication.
 * Extracts JWT from Authorization header and validates it.
 * Sets req.user with the decoded payload.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
	const authHeader = req.headers.authorization;

	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		res.status(401).json({ error: 'Authentication required' });
		return;
	}

	const token = authHeader.substring(7); // Remove 'Bearer ' prefix
	const payload = verifyToken(token);

	if (!payload) {
		res.status(401).json({ error: 'Invalid or expired token' });
		return;
	}

	req.user = payload;
	next();
}

/**
 * Optional auth middleware - sets req.user if valid token present,
 * but doesn't require authentication.
 */
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
	const authHeader = req.headers.authorization;

	if (authHeader && authHeader.startsWith('Bearer ')) {
		const token = authHeader.substring(7);
		const payload = verifyToken(token);
		if (payload) {
			req.user = payload;
		}
	}

	next();
}
