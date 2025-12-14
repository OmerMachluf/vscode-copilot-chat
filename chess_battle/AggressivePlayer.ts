/**
 * Aggressive Chess Player Implementation
 *
 * This module implements an aggressive chess playing strategy that prioritizes
 * attacking moves, piece activity, and creating threats over defensive play.
 * The player is willing to sacrifice material for attacking chances and
 * consistently seeks to put pressure on the opponent's position.
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Represents a square on the chess board using algebraic notation.
 * Files are a-h (columns), ranks are 1-8 (rows).
 */
export type Square = string;

/**
 * Represents a chess piece color.
 */
export type Color = 'white' | 'black';

/**
 * Represents a chess piece type.
 */
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

/**
 * Represents a chess piece with its type and color.
 */
export interface Piece {
	readonly type: PieceType;
	readonly color: Color;
}

/**
 * Represents a chess move from one square to another.
 */
export interface Move {
	/** The starting square of the move (e.g., "e2") */
	readonly from: Square;
	/** The destination square of the move (e.g., "e4") */
	readonly to: Square;
	/** The piece type to promote to (for pawn promotion moves) */
	readonly promotion?: PieceType;
	/** Whether this move is a capture */
	readonly isCapture?: boolean;
	/** Whether this move gives check */
	readonly isCheck?: boolean;
	/** The captured piece type (if capture) */
	readonly capturedPiece?: PieceType;
}

/**
 * Represents a chess board state with methods for querying and manipulation.
 */
export interface ChessBoard {
	/** Get the piece at a given square, or null if empty */
	getPieceAt(square: Square): Piece | null;

	/** Get all legal moves for the current position */
	getLegalMoves(): Move[];

	/** Get the current side to move */
	getTurn(): Color;

	/** Check if the current side is in check */
	isCheck(): boolean;

	/** Check if the game is in checkmate */
	isCheckmate(): boolean;

	/** Check if the game is a stalemate */
	isStalemate(): boolean;

	/** Check if the position has insufficient material for checkmate */
	isInsufficientMaterial(): boolean;

	/** Make a move on the board (returns a new board state) */
	makeMove(move: Move): ChessBoard;

	/** Get all squares occupied by pieces of a given color */
	getPiecesOfColor(color: Color): Array<{ square: Square; piece: Piece }>;

	/** Get the square of the king of a given color */
	getKingSquare(color: Color): Square | null;

	/** Get all squares that attack a given square */
	getAttackers(square: Square, byColor: Color): Square[];

	/** Check if a side has kingside castling rights */
	hasKingsideCastling(color: Color): boolean;

	/** Check if a side has queenside castling rights */
	hasQueensideCastling(color: Color): boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Piece values in centipawns for material evaluation.
 */
const PIECE_VALUES: Record<PieceType, number> = {
	pawn: 100,
	knight: 320,
	bishop: 330,
	rook: 500,
	queen: 900,
	king: 20000,
};

/**
 * Bonus for attacking squares near the enemy king.
 */
const KING_ATTACK_BONUS = 15;

/**
 * Bonus for pieces positioned aggressively (in center or enemy territory).
 */
const AGGRESSIVE_POSITION_BONUS: Record<PieceType, number> = {
	pawn: 10,
	knight: 20,
	bishop: 15,
	rook: 10,
	queen: 25,
	king: 0,
};

/**
 * Center squares for control bonus.
 */
const CENTER_SQUARES: Square[] = ['d4', 'd5', 'e4', 'e5'];

/**
 * Extended center squares.
 */
const EXTENDED_CENTER: Square[] = [
	'c3', 'c4', 'c5', 'c6',
	'd3', 'd4', 'd5', 'd6',
	'e3', 'e4', 'e5', 'e6',
	'f3', 'f4', 'f5', 'f6',
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the file (column) of a square as a number (0-7 for a-h).
 */
function getFile(square: Square): number {
	return square.charCodeAt(0) - 'a'.charCodeAt(0);
}

/**
 * Get the rank (row) of a square as a number (0-7 for ranks 1-8).
 */
function getRank(square: Square): number {
	return parseInt(square[1], 10) - 1;
}

/**
 * Create a square from file and rank numbers.
 */
function squareFromCoords(file: number, rank: number): Square {
	return String.fromCharCode('a'.charCodeAt(0) + file) + (rank + 1).toString();
}

/**
 * Get all squares in the king's zone (king + surrounding 8 squares).
 */
function getKingZone(kingSquare: Square): Square[] {
	const zone: Square[] = [kingSquare];
	const kingFile = getFile(kingSquare);
	const kingRank = getRank(kingSquare);

	for (let df = -1; df <= 1; df++) {
		for (let dr = -1; dr <= 1; dr++) {
			if (df === 0 && dr === 0) {
				continue;
			}
			const f = kingFile + df;
			const r = kingRank + dr;
			if (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
				zone.push(squareFromCoords(f, r));
			}
		}
	}

	return zone;
}

/**
 * Get the opposite color.
 */
function oppositeColor(color: Color): Color {
	return color === 'white' ? 'black' : 'white';
}

// ============================================================================
// Aggressive Chess Player
// ============================================================================

/**
 * An aggressive chess player that prioritizes attacks and threats.
 *
 * This player uses a minimax algorithm with alpha-beta pruning, but with
 * an evaluation function heavily biased toward aggressive play:
 * - Captures and attacks are highly valued
 * - Piece activity and mobility are prioritized
 * - Center control enables attacking chances
 * - Pieces aimed at the enemy king receive bonuses
 * - Material sacrifices for attacking positions are acceptable
 *
 * @example
 * ```typescript
 * const player = new AggressivePlayer({ name: 'Attacker', searchDepth: 3 });
 * const board: ChessBoard = getInitialBoard();
 * const bestMove = player.selectMove(board);
 * console.log(`Best aggressive move: ${bestMove.from}-${bestMove.to}`);
 * ```
 */
export class AggressivePlayer {
	/** The name of this player */
	public readonly name: string;

	/** How many moves ahead to search */
	public readonly searchDepth: number;

	/** Counter for nodes searched (for debugging/statistics) */
	private nodesSearched: number = 0;

	/**
	 * Create a new aggressive chess player.
	 *
	 * @param options - Configuration options for the player
	 * @param options.name - The name of the player (default: 'Aggressive Player')
	 * @param options.searchDepth - How many moves ahead to search (default: 3)
	 */
	constructor(options: { name?: string; searchDepth?: number } = {}) {
		this.name = options.name ?? 'Aggressive Player';
		this.searchDepth = options.searchDepth ?? 3;
	}

	/**
	 * Select the best move for the current position using aggressive strategy.
	 *
	 * The move selection is guided by an evaluation function that heavily
	 * favors attacking moves, threats, and piece activity. The player will
	 * prefer sacrifices that lead to strong attacking positions.
	 *
	 * @param board - The current chess board position
	 * @returns The best move according to the aggressive strategy, or null if no legal moves
	 */
	public selectMove(board: ChessBoard): Move | null {
		this.nodesSearched = 0;

		const legalMoves = board.getLegalMoves();
		if (legalMoves.length === 0) {
			return null;
		}

		let bestMove: Move | null = null;
		let bestScore = Number.NEGATIVE_INFINITY;
		let alpha = Number.NEGATIVE_INFINITY;
		const beta = Number.POSITIVE_INFINITY;

		// Order moves to improve alpha-beta efficiency
		// Aggressive ordering: captures and checks first
		const orderedMoves = this.orderMoves(board, legalMoves);

		for (const move of orderedMoves) {
			const newBoard = board.makeMove(move);
			this.nodesSearched++;

			const score = -this.minimax(newBoard, this.searchDepth - 1, -beta, -alpha);

			if (score > bestScore) {
				bestScore = score;
				bestMove = move;
			}

			alpha = Math.max(alpha, score);
		}

		return bestMove;
	}

	/**
	 * Get the number of nodes searched in the last move selection.
	 *
	 * Useful for debugging and performance analysis.
	 */
	public getNodesSearched(): number {
		return this.nodesSearched;
	}

	/**
	 * Evaluate the board position with an aggressive bias.
	 *
	 * The evaluation prioritizes:
	 * - Material advantage (but willing to sacrifice for attacks)
	 * - Attacking potential against enemy king
	 * - Piece mobility and activity
	 * - Center control for launching attacks
	 * - Threats and hanging pieces
	 *
	 * @param board - The current chess board position
	 * @returns A score in centipawns from the current player's perspective.
	 *          Positive values favor the side to move.
	 */
	public evaluatePosition(board: ChessBoard): number {
		// Terminal positions
		if (board.isCheckmate()) {
			// Checkmate is the worst for the side to move
			return -99999;
		}

		if (board.isStalemate() || board.isInsufficientMaterial()) {
			return 0;
		}

		let score = 0;

		// Material evaluation
		score += this.evaluateMaterial(board);

		// Aggressive bonuses
		score += this.evaluateAttacks(board);
		score += this.evaluateKingSafetyDifferential(board);
		score += this.evaluatePieceActivity(board);
		score += this.evaluateCenterControl(board);
		score += this.evaluateThreats(board);

		// Return score from perspective of side to move
		const turn = board.getTurn();
		return turn === 'white' ? score : -score;
	}

	/**
	 * Minimax search with alpha-beta pruning.
	 *
	 * @param board - Current board position
	 * @param depth - Remaining search depth
	 * @param alpha - Alpha bound for pruning
	 * @param beta - Beta bound for pruning
	 * @returns The evaluation score for the position
	 */
	private minimax(board: ChessBoard, depth: number, alpha: number, beta: number): number {
		if (depth === 0 || board.isCheckmate() || board.isStalemate()) {
			return this.evaluatePosition(board);
		}

		const legalMoves = board.getLegalMoves();
		if (legalMoves.length === 0) {
			return this.evaluatePosition(board);
		}

		// Order moves for better pruning
		const orderedMoves = this.orderMoves(board, legalMoves);

		let bestScore = Number.NEGATIVE_INFINITY;

		for (const move of orderedMoves) {
			const newBoard = board.makeMove(move);
			this.nodesSearched++;

			const score = -this.minimax(newBoard, depth - 1, -beta, -alpha);

			bestScore = Math.max(bestScore, score);
			alpha = Math.max(alpha, score);

			if (alpha >= beta) {
				break; // Beta cutoff
			}
		}

		return bestScore;
	}

	/**
	 * Order moves for better alpha-beta pruning efficiency.
	 *
	 * Aggressive ordering prioritizes:
	 * 1. Captures (especially winning captures using MVV-LVA)
	 * 2. Checks
	 * 3. Promotions
	 * 4. Central moves
	 * 5. Advancing pieces toward enemy territory
	 *
	 * @param board - Current board position
	 * @param moves - List of legal moves to order
	 * @returns Moves sorted by aggressive potential (best first)
	 */
	private orderMoves(board: ChessBoard, moves: Move[]): Move[] {
		const moveScores = moves.map(move => {
			let score = 0;

			// Captures are highly valued (MVV-LVA: Most Valuable Victim - Least Valuable Attacker)
			if (move.isCapture && move.capturedPiece) {
				const attacker = board.getPieceAt(move.from);
				const capturedValue = PIECE_VALUES[move.capturedPiece];
				const attackerValue = attacker ? PIECE_VALUES[attacker.type] : 0;
				score += 10000 + capturedValue - Math.floor(attackerValue / 10);
			}

			// Checks are very aggressive
			if (move.isCheck) {
				score += 5000;
			}

			// Promotions are valuable
			if (move.promotion) {
				score += 8000 + PIECE_VALUES[move.promotion];
			}

			// Central moves
			if (CENTER_SQUARES.includes(move.to)) {
				score += 100;
			} else if (EXTENDED_CENTER.includes(move.to)) {
				score += 50;
			}

			// Advancing pieces is aggressive
			const piece = board.getPieceAt(move.from);
			if (piece) {
				const toRank = getRank(move.to);
				const fromRank = getRank(move.from);
				if (piece.color === 'white') {
					score += (toRank - fromRank) * 20;
				} else {
					score += (fromRank - toRank) * 20;
				}
			}

			return { move, score };
		});

		// Sort by score descending (best moves first)
		moveScores.sort((a, b) => b.score - a.score);

		return moveScores.map(ms => ms.move);
	}

	/**
	 * Calculate material balance.
	 *
	 * @param board - Current board position
	 * @returns Material score (positive favors white)
	 */
	private evaluateMaterial(board: ChessBoard): number {
		let score = 0;

		const whitePieces = board.getPiecesOfColor('white');
		const blackPieces = board.getPiecesOfColor('black');

		for (const { piece } of whitePieces) {
			score += PIECE_VALUES[piece.type];
		}

		for (const { piece } of blackPieces) {
			score -= PIECE_VALUES[piece.type];
		}

		return score;
	}

	/**
	 * Evaluate attacking potential - heavily weighted for aggressive play.
	 *
	 * Rewards:
	 * - Pieces attacking enemy pieces
	 * - Being in a position to give check
	 *
	 * @param board - Current board position
	 * @returns Attack evaluation score
	 */
	private evaluateAttacks(board: ChessBoard): number {
		let score = 0;

		// Bonus for having the opponent in check
		if (board.isCheck()) {
			const turn = board.getTurn();
			// If it's white's turn and they're in check, that's bad for white
			score += turn === 'white' ? -50 : 50;
		}

		// Count attacks on enemy pieces
		const whitePieces = board.getPiecesOfColor('white');
		const blackPieces = board.getPiecesOfColor('black');

		// White attacks on black pieces
		for (const { square, piece } of blackPieces) {
			const attackers = board.getAttackers(square, 'white');
			let attackValue = attackers.length * 10;

			// Extra bonus for attacking high-value pieces
			if (piece.type === 'queen' || piece.type === 'rook') {
				attackValue *= 1.5;
			}

			score += attackValue;
		}

		// Black attacks on white pieces
		for (const { square, piece } of whitePieces) {
			const attackers = board.getAttackers(square, 'black');
			let attackValue = attackers.length * 10;

			// Extra bonus for attacking high-value pieces
			if (piece.type === 'queen' || piece.type === 'rook') {
				attackValue *= 1.5;
			}

			score -= attackValue;
		}

		return score;
	}

	/**
	 * Evaluate attacks near the enemy king vs our king safety.
	 *
	 * Aggressive players want to attack the enemy king while
	 * accepting some risk to their own king.
	 *
	 * @param board - Current board position
	 * @returns King safety differential score
	 */
	private evaluateKingSafetyDifferential(board: ChessBoard): number {
		let score = 0;

		const whiteKingSquare = board.getKingSquare('white');
		const blackKingSquare = board.getKingSquare('black');

		if (!whiteKingSquare || !blackKingSquare) {
			return 0;
		}

		// Get squares around each king
		const whiteKingZone = getKingZone(whiteKingSquare);
		const blackKingZone = getKingZone(blackKingSquare);

		// Count white attacks on black king zone (very valuable for aggressive play)
		for (const square of blackKingZone) {
			const whiteAttackers = board.getAttackers(square, 'white');
			score += whiteAttackers.length * KING_ATTACK_BONUS;
		}

		// Count black attacks on white king zone
		for (const square of whiteKingZone) {
			const blackAttackers = board.getAttackers(square, 'black');
			score -= blackAttackers.length * KING_ATTACK_BONUS;
		}

		// Small penalty for losing castling rights (aggressive players often delay castling)
		if (!board.hasKingsideCastling('white') && !board.hasQueensideCastling('white')) {
			score -= 10;
		}
		if (!board.hasKingsideCastling('black') && !board.hasQueensideCastling('black')) {
			score += 10;
		}

		return score;
	}

	/**
	 * Evaluate piece mobility and activity.
	 *
	 * Aggressive players value active pieces that can participate in attacks.
	 *
	 * @param board - Current board position
	 * @returns Piece activity score
	 */
	private evaluatePieceActivity(board: ChessBoard): number {
		let score = 0;

		// Mobility bonus based on number of legal moves
		// This is a simplified approximation - ideally we'd count moves per side
		const legalMoves = board.getLegalMoves();
		const turn = board.getTurn();
		const mobilityValue = legalMoves.length * 5;

		// Positive for the side to move
		score += turn === 'white' ? mobilityValue : -mobilityValue;

		// Bonus for pieces advanced into enemy territory
		const whitePieces = board.getPiecesOfColor('white');
		const blackPieces = board.getPiecesOfColor('black');

		for (const { square, piece } of whitePieces) {
			const rank = getRank(square);
			if (rank >= 4) {
				const bonus = AGGRESSIVE_POSITION_BONUS[piece.type] * (rank - 3);
				score += bonus;
			}
		}

		for (const { square, piece } of blackPieces) {
			const rank = getRank(square);
			if (rank <= 3) {
				const bonus = AGGRESSIVE_POSITION_BONUS[piece.type] * (4 - rank);
				score -= bonus;
			}
		}

		return score;
	}

	/**
	 * Evaluate center control for attacking potential.
	 *
	 * Center control enables piece coordination for attacks.
	 *
	 * @param board - Current board position
	 * @returns Center control score
	 */
	private evaluateCenterControl(board: ChessBoard): number {
		let score = 0;

		// Strong center control bonus
		for (const square of CENTER_SQUARES) {
			const piece = board.getPieceAt(square);
			if (piece !== null) {
				const value = piece.color === 'white' ? 30 : -30;
				score += value;
			}

			// Also count attackers of center
			const whiteControl = board.getAttackers(square, 'white').length;
			const blackControl = board.getAttackers(square, 'black').length;
			score += (whiteControl - blackControl) * 8;
		}

		// Extended center is also valuable
		for (const square of EXTENDED_CENTER) {
			if (CENTER_SQUARES.includes(square)) {
				continue;
			}
			const whiteControl = board.getAttackers(square, 'white').length;
			const blackControl = board.getAttackers(square, 'black').length;
			score += (whiteControl - blackControl) * 4;
		}

		return score;
	}

	/**
	 * Evaluate immediate threats and tactical opportunities.
	 *
	 * Aggressive players love having threats on the board,
	 * especially undefended (hanging) pieces.
	 *
	 * @param board - Current board position
	 * @returns Threat evaluation score
	 */
	private evaluateThreats(board: ChessBoard): number {
		let score = 0;

		const whitePieces = board.getPiecesOfColor('white');
		const blackPieces = board.getPiecesOfColor('black');

		// Check for threats on white pieces (bad for white)
		for (const { square, piece } of whitePieces) {
			const attackers = board.getAttackers(square, 'black');
			const defenders = board.getAttackers(square, 'white');

			if (attackers.length > 0) {
				if (defenders.length === 0) {
					// Hanging piece! Big penalty for white
					const threatValue = PIECE_VALUES[piece.type] * 0.5;
					score -= threatValue;
				} else if (attackers.length > defenders.length) {
					// More attackers than defenders
					const threatValue = PIECE_VALUES[piece.type] * 0.2;
					score -= threatValue;
				}
			}
		}

		// Check for threats on black pieces (good for white)
		for (const { square, piece } of blackPieces) {
			const attackers = board.getAttackers(square, 'white');
			const defenders = board.getAttackers(square, 'black');

			if (attackers.length > 0) {
				if (defenders.length === 0) {
					// Hanging piece! Big bonus for white
					const threatValue = PIECE_VALUES[piece.type] * 0.5;
					score += threatValue;
				} else if (attackers.length > defenders.length) {
					// More attackers than defenders
					const threatValue = PIECE_VALUES[piece.type] * 0.2;
					score += threatValue;
				}
			}
		}

		return score;
	}
}
