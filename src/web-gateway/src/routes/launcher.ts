import { Router, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { requireAuth, launcherRateLimiter, type AuthenticatedRequest } from '../middleware';
import { config } from '../config';

const router = Router();

/**
 * In-memory store for recent items.
 * In production, this could be persisted to a database or file.
 */
interface RecentItem {
	path: string;
	openedAt: string;
	openedBy: string;
}

const recentItems: RecentItem[] = [];

/**
 * Get the VS Code CLI command based on the platform.
 */
function getCodeCommand(): string {
	if (process.platform === 'win32') {
		return 'code.cmd';
	}
	return 'code';
}

/**
 * Normalize a path for cross-platform comparison.
 * Resolves to absolute path and normalizes separators.
 */
function normalizePath(inputPath: string): string {
	// Resolve to absolute path
	const absolutePath = path.resolve(inputPath);
	// Normalize separators (uses platform-specific separator)
	return path.normalize(absolutePath);
}

/**
 * Check if a path is within any of the allowed directories.
 * This is a security measure to prevent arbitrary file access.
 */
function isPathAllowed(targetPath: string, allowedDirs: string[]): boolean {
	// If no allowed directories are configured, deny all in production
	if (allowedDirs.length === 0) {
		// In development, allow all paths if not configured
		if (config.nodeEnv === 'development') {
			return true;
		}
		return false;
	}

	const normalizedTarget = normalizePath(targetPath);

	return allowedDirs.some(allowedDir => {
		const normalizedAllowed = normalizePath(allowedDir);
		// Check if target path starts with allowed directory
		// Use lowercase comparison on Windows for case-insensitivity
		if (process.platform === 'win32') {
			return normalizedTarget.toLowerCase().startsWith(normalizedAllowed.toLowerCase());
		}
		return normalizedTarget.startsWith(normalizedAllowed);
	});
}

/**
 * Check if a path exists (file or directory).
 */
async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.promises.access(targetPath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Add an item to the recent list.
 */
function addToRecent(itemPath: string, userId: string): void {
	// Remove existing entry for this path if present
	const existingIndex = recentItems.findIndex(
		item => normalizePath(item.path) === normalizePath(itemPath)
	);
	if (existingIndex !== -1) {
		recentItems.splice(existingIndex, 1);
	}

	// Add to the beginning
	recentItems.unshift({
		path: itemPath,
		openedAt: new Date().toISOString(),
		openedBy: userId,
	});

	// Trim to max size
	while (recentItems.length > config.launcherMaxRecent) {
		recentItems.pop();
	}
}

/**
 * POST /api/launcher/open
 *
 * Open a file or folder in VS Code.
 * Rate limited to 5 requests per minute per user.
 *
 * Request body:
 *   - path: string (required) - The file or folder path to open
 *   - newWindow: boolean (optional) - Open in a new window (default: false)
 */
router.post('/open', requireAuth, launcherRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
	const { path: targetPath, newWindow = false } = req.body as {
		path?: string;
		newWindow?: boolean;
	};

	// Validate required fields
	if (!targetPath) {
		res.status(400).json({ error: 'Path is required' });
		return;
	}

	if (typeof targetPath !== 'string') {
		res.status(400).json({ error: 'Path must be a string' });
		return;
	}

	// Security: Validate path is within allowed directories
	if (!isPathAllowed(targetPath, config.launcherAllowedDirs)) {
		res.status(403).json({
			error: 'Path is not within allowed directories',
			allowedDirs: config.nodeEnv === 'development' ? config.launcherAllowedDirs : undefined,
		});
		return;
	}

	// Validate path exists
	const normalizedPath = normalizePath(targetPath);
	if (!await pathExists(normalizedPath)) {
		res.status(404).json({ error: 'Path does not exist' });
		return;
	}

	// Build command arguments
	const args: string[] = [];
	if (newWindow) {
		args.push('--new-window');
	}
	args.push(normalizedPath);

	try {
		const command = getCodeCommand();

		// Spawn the VS Code process
		const child = spawn(command, args, {
			detached: true,
			stdio: 'ignore',
			shell: process.platform === 'win32', // Use shell on Windows for .cmd files
		});

		// Unref to allow the parent process to exit independently
		child.unref();

		// Add to recent list
		addToRecent(normalizedPath, req.user?.sub ?? 'unknown');

		res.json({
			success: true,
			message: `Opened ${normalizedPath} in VS Code`,
			path: normalizedPath,
			newWindow,
		});
	} catch (error) {
		console.error('Failed to launch VS Code:', error);
		res.status(500).json({
			error: 'Failed to launch VS Code',
			details: config.nodeEnv === 'development' ? String(error) : undefined,
		});
	}
});

/**
 * GET /api/launcher/recent
 *
 * Get the list of recently opened files/folders.
 * Query parameters:
 *   - limit: number (optional) - Maximum number of items to return (default: 10)
 */
router.get('/recent', requireAuth, (req: AuthenticatedRequest, res: Response) => {
	const limit = Math.min(
		Math.max(1, parseInt(String(req.query.limit), 10) || 10),
		config.launcherMaxRecent
	);

	const items = recentItems.slice(0, limit).map(item => ({
		path: item.path,
		name: path.basename(item.path),
		openedAt: item.openedAt,
	}));

	res.json({
		items,
		total: recentItems.length,
	});
});

/**
 * GET /api/launcher/config
 *
 * Get the launcher configuration (allowed directories).
 * Useful for clients to know which paths are valid.
 */
router.get('/config', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
	res.json({
		allowedDirs: config.launcherAllowedDirs,
		maxRecent: config.launcherMaxRecent,
		platform: os.platform(),
	});
});

export const launcherRouter = router;
