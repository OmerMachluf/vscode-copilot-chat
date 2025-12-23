import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { generateToken, requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

/**
 * Authentication configuration from environment variables.
 * For development, uses sensible defaults that work out of the box.
 */
interface AuthConfig {
	/** Admin email for password-based auth */
	adminEmail: string;
	/** Hashed admin password */
	adminPasswordHash: string | null;
	/** Valid API keys (comma-separated in env) */
	apiKeys: Set<string>;
}

/**
 * Load authentication configuration from environment.
 * In development mode, creates default credentials.
 */
function loadAuthConfig(): AuthConfig {
	const isDev = process.env.NODE_ENV !== 'production';

	// Get admin email (default for dev)
	const adminEmail = process.env.ADMIN_EMAIL || (isDev ? 'admin@localhost' : '');

	// Get admin password - hash it if provided as plaintext
	const adminPassword = process.env.ADMIN_PASSWORD;
	let adminPasswordHash: string | null = null;

	if (adminPassword) {
		// If ADMIN_PASSWORD_HASH is provided, use it directly
		if (process.env.ADMIN_PASSWORD_HASH) {
			adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
		} else {
			// Hash the plaintext password synchronously at startup
			adminPasswordHash = bcrypt.hashSync(adminPassword, 10);
		}
	} else if (isDev) {
		// Default dev password: 'admin123'
		adminPasswordHash = bcrypt.hashSync('admin123', 10);
	}

	// Parse API keys from comma-separated list
	const apiKeysStr = process.env.API_KEYS || '';
	const apiKeys = new Set(
		apiKeysStr
			.split(',')
			.map(key => key.trim())
			.filter(key => key.length >= 16), // Minimum 16 characters for security
	);

	// Add default dev API key
	if (isDev && apiKeys.size === 0) {
		apiKeys.add('dev-api-key-12345678'); // 20 chars
	}

	return {
		adminEmail,
		adminPasswordHash,
		apiKeys,
	};
}

// Load config once at module initialization
const authConfig = loadAuthConfig();

// Log auth configuration in development
if (process.env.NODE_ENV !== 'production') {
	console.log('Auth configuration loaded:');
	console.log(`  Admin email: ${authConfig.adminEmail}`);
	console.log(`  Password auth: ${authConfig.adminPasswordHash ? 'enabled' : 'disabled'}`);
	console.log(`  API keys configured: ${authConfig.apiKeys.size}`);
	if (authConfig.apiKeys.size > 0 && !process.env.API_KEYS) {
		console.log('  Default dev API key: dev-api-key-12345678');
	}
	if (!process.env.ADMIN_PASSWORD) {
		console.log('  Default dev password: admin123');
	}
}

/**
 * POST /api/auth/login
 *
 * Authenticate a user and return a JWT token.
 * Supports two authentication methods:
 * - Password-based: { email: string, password: string }
 * - API key-based: { apiKey: string }
 */
router.post('/login', async (req: Request, res: Response) => {
	const { email, password, apiKey } = req.body as {
		email?: string;
		password?: string;
		apiKey?: string;
	};

	try {
		// API key authentication
		if (apiKey) {
			if (!authConfig.apiKeys.has(apiKey)) {
				res.status(401).json({ error: 'Invalid API key' });
				return;
			}

			const token = generateToken({
				sub: 'api-key-user',
				method: 'api-key',
			});

			res.json({ token });
			return;
		}

		// Password-based authentication
		if (email && password) {
			// Check if email matches admin email
			if (email.toLowerCase() !== authConfig.adminEmail.toLowerCase()) {
				res.status(401).json({ error: 'Invalid email or password' });
				return;
			}

			// Verify password
			if (!authConfig.adminPasswordHash) {
				res.status(401).json({ error: 'Password authentication is not configured' });
				return;
			}

			const isValid = await bcrypt.compare(password, authConfig.adminPasswordHash);
			if (!isValid) {
				res.status(401).json({ error: 'Invalid email or password' });
				return;
			}

			const token = generateToken({
				sub: email,
				method: 'password',
			});

			res.json({ token });
			return;
		}

		// Neither authentication method provided
		res.status(400).json({
			error: 'Please provide either email/password or apiKey',
		});
	} catch (error) {
		console.error('Login error:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

/**
 * POST /api/auth/logout
 *
 * Logout endpoint. Since we use stateless JWT, this is primarily
 * for client-side token cleanup. The client should remove the token
 * from localStorage after calling this endpoint.
 *
 * In a production system, you might want to implement token blacklisting
 * using Redis or a similar store.
 */
router.post('/logout', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
	// With stateless JWT, we can't truly invalidate the token server-side
	// without maintaining a blacklist. For now, just acknowledge the logout.
	res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 *
 * Get the current authenticated user's information.
 * Requires a valid JWT token in the Authorization header.
 */
router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
	const user = req.user!;

	res.json({
		user: {
			id: user.sub,
			method: user.method,
			// Don't expose sensitive token metadata
		},
	});
});

export const authRouter = router;
