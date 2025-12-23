import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Environment configuration for the Web Gateway server.
 * All configuration values can be overridden via environment variables.
 */
export interface Config {
	/** Server port (default: 3000) */
	port: number;
	/** Node environment (development, production, test) */
	nodeEnv: string;
	/** JWT secret for token signing */
	jwtSecret: string;
	/** JWT token expiration time (default: 24h) */
	jwtExpiresIn: string;
	/** Extension API base URL (default: http://localhost:3001) */
	extensionApiUrl: string;
	/** Allowed CORS origins (comma-separated, default: same-origin only) */
	corsOrigins: string[];
	/** Rate limit window in milliseconds (default: 15 minutes) */
	rateLimitWindowMs: number;
	/** Maximum requests per rate limit window (default: 100) */
	rateLimitMax: number;
	/** Enable request logging (default: true in development) */
	enableLogging: boolean;
	/** Allowed directories for launcher operations (security whitelist) */
	launcherAllowedDirs: string[];
	/** Maximum number of recent items to store */
	launcherMaxRecent: number;
}

/**
 * Parse comma-separated string into array, filtering empty values.
 */
function parseOrigins(origins: string | undefined): string[] {
	if (!origins) {
		return [];
	}
	return origins.split(',').map(o => o.trim()).filter(Boolean);
}

/**
 * Parse comma-separated paths into array, normalizing path separators.
 */
function parsePaths(paths: string | undefined): string[] {
	if (!paths) {
		return [];
	}
	return paths.split(',').map(p => p.trim()).filter(Boolean);
}

/**
 * Get a required environment variable or throw an error.
 */
function getRequiredEnv(key: string): string {
	const value = process.env[key];
	if (!value) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
}

/**
 * Get an optional environment variable with a default value.
 */
function getOptionalEnv(key: string, defaultValue: string): string {
	return process.env[key] ?? defaultValue;
}

/**
 * Parse an integer environment variable with a default value.
 */
function getIntEnv(key: string, defaultValue: number): number {
	const value = process.env[key];
	if (!value) {
		return defaultValue;
	}
	const parsed = parseInt(value, 10);
	if (isNaN(parsed)) {
		console.warn(`Invalid integer for ${key}: ${value}, using default: ${defaultValue}`);
		return defaultValue;
	}
	return parsed;
}

/**
 * Parse a boolean environment variable with a default value.
 */
function getBoolEnv(key: string, defaultValue: boolean): boolean {
	const value = process.env[key];
	if (!value) {
		return defaultValue;
	}
	return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Create and validate the configuration object.
 */
export function createConfig(): Config {
	const nodeEnv = getOptionalEnv('NODE_ENV', 'development');
	const isDev = nodeEnv === 'development';

	// JWT_SECRET is required in production
	let jwtSecret: string;
	if (nodeEnv === 'production') {
		jwtSecret = getRequiredEnv('JWT_SECRET');
	} else {
		jwtSecret = getOptionalEnv('JWT_SECRET', 'dev-secret-change-in-production');
	}

	return {
		port: getIntEnv('PORT', 3000),
		nodeEnv,
		jwtSecret,
		jwtExpiresIn: getOptionalEnv('JWT_EXPIRES_IN', '24h'),
		extensionApiUrl: getOptionalEnv('EXTENSION_API_URL', 'http://localhost:3001'),
		corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
		rateLimitWindowMs: getIntEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), // 15 minutes
		rateLimitMax: getIntEnv('RATE_LIMIT_MAX', 100),
		enableLogging: getBoolEnv('ENABLE_LOGGING', isDev),
		launcherAllowedDirs: parsePaths(process.env.LAUNCHER_ALLOWED_DIRS),
		launcherMaxRecent: getIntEnv('LAUNCHER_MAX_RECENT', 20),
	};
}

/**
 * Singleton configuration instance.
 */
export const config = createConfig();
