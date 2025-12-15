/**
 * Defensive Chess Player Implementation
 *
 * This module implements a defensive chess playing strategy that prioritizes:
 * - King safety and early castling
 * - Strong pawn structures
 * - Defensive piece positioning (knights on f3/c3, bishops protecting key squares)
 * - Avoiding risky exchanges unless clearly advantageous
 * - Solid, closed positions
 */

// ============================================================================
// Types and Interfaces (re-exported from shared types)
// ============================================================================

/** Piece colors */
export type Color = 'white' | 'black';

/** Chess piece types */
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

/** Represents a chess piece */
export interface Piece {
	readonly type: PieceType;
	readonly color: Color;
}

/** Board position (0-7 for both rank and file) */
export interface Position {
	readonly rank: number; // 0-7 (1-8 in chess notation)
	readonly file: number; // 0-7 (a-h in chess notation)
}

/** Represents a chess move */
export interface Move {
	readonly from: Position;
	readonly to: Position;
	readonly promotion?: PieceType;
	readonly isCapture?: boolean;
	readonly isCastle?: boolean;
	readonly isEnPassant?: boolean;
}

/** 8x8 chess board representation */
export type Board = (Piece | null)[][];

/** Complete game state */
export interface GameState {
	readonly board: Board;
	readonly currentPlayer: Color;
	readonly castlingRights: CastlingRights;
	readonly enPassantTarget: Position | null;
	readonly halfMoveClock: number;
	readonly fullMoveNumber: number;
}

/** Castling availability */
export interface CastlingRights {
	readonly whiteKingside: boolean;
	readonly whiteQueenside: boolean;
	readonly blackKingside: boolean;
	readonly blackQueenside: boolean;
}

/** Move with its evaluation score */
export interface ScoredMove {
	readonly move: Move;
	readonly score: number;
}

// ============================================================================
// Defensive Strategy Constants
// ============================================================================

/** Piece values for material evaluation */
const PIECE_VALUES: Record<PieceType, number> = {
	pawn: 100,
	knight: 320,
	bishop: 330,
	rook: 500,
	queen: 900,
	king: 20000,
};

/** Bonus for castling (defensive players love castled kings) */
const CASTLED_KING_BONUS = 80;

/** Penalty for king in center (unsafe!) */
const KING_CENTER_PENALTY = -50;

/** Bonus for king behind pawn shield */
const PAWN_SHIELD_BONUS = 25;

/** Bonus for knights on ideal defensive squares (f3/c3 for white, f6/c6 for black) */
const KNIGHT_IDEAL_SQUARE_BONUS = 30;

/** Bonus for bishop protecting key squares */
const BISHOP_PROTECTION_BONUS = 20;

/** Bonus for pawns forming a solid chain */
const PAWN_CHAIN_BONUS = 15;

/** Penalty for isolated pawns (defensive weakness) */
const ISOLATED_PAWN_PENALTY = -25;

/** Penalty for backward pawns */
const BACKWARD_PAWN_PENALTY = -20;

/** Penalty for doubled pawns */
const DOUBLED_PAWN_PENALTY = -15;

/** Bonus for control of key central squares without overextending */
const CENTRAL_CONTROL_BONUS = 20;

/** Penalty for pieces too far advanced (risky!) */
const OVEREXTENSION_PENALTY = -15;

/** Bonus for pieces defending each other */
const PIECE_COORDINATION_BONUS = 10;

/** Penalty for making risky exchanges */
const RISKY_EXCHANGE_PENALTY = -30;

/** Bonus for maintaining material balance */
const MATERIAL_BALANCE_BONUS = 10;

/** Bonus for closed pawn structures (defensive player prefers) */
const CLOSED_POSITION_BONUS = 15;

/** Penalty for exposed king */
const EXPOSED_KING_PENALTY = -40;

/** Search depth for minimax algorithm */
const SEARCH_DEPTH = 3;

// ============================================================================
// Board Utilities
// ============================================================================

/**
 * Creates a new standard chess starting position
 */
export function createInitialBoard(): Board {
	const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));

	// Set up pawns
	for (let file = 0; file < 8; file++) {
		board[1][file] = { type: 'pawn', color: 'white' };
		board[6][file] = { type: 'pawn', color: 'black' };
	}

	// Set up back ranks
	const backRankPieces: PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

	for (let file = 0; file < 8; file++) {
		board[0][file] = { type: backRankPieces[file], color: 'white' };
		board[7][file] = { type: backRankPieces[file], color: 'black' };
	}

	return board;
}

/**
 * Creates the initial game state
 */
export function createInitialGameState(): GameState {
	return {
		board: createInitialBoard(),
		currentPlayer: 'white',
		castlingRights: {
			whiteKingside: true,
			whiteQueenside: true,
			blackKingside: true,
			blackQueenside: true,
		},
		enPassantTarget: null,
		halfMoveClock: 0,
		fullMoveNumber: 1,
	};
}

/**
 * Gets the piece at a given position
 */
export function getPieceAt(board: Board, pos: Position): Piece | null {
	if (!isValidPosition(pos)) {
		return null;
	}
	return board[pos.rank][pos.file];
}

/**
 * Checks if a position is within the board bounds
 */
export function isValidPosition(pos: Position): boolean {
	return pos.rank >= 0 && pos.rank < 8 && pos.file >= 0 && pos.file < 8;
}

/**
 * Creates a deep copy of the board
 */
export function cloneBoard(board: Board): Board {
	return board.map(rank => [...rank]);
}

/**
 * Creates a deep copy of the game state
 */
export function cloneGameState(state: GameState): GameState {
	return {
		...state,
		board: cloneBoard(state.board),
		castlingRights: { ...state.castlingRights },
		enPassantTarget: state.enPassantTarget ? { ...state.enPassantTarget } : null,
	};
}

/**
 * Gets the opponent's color
 */
export function getOpponentColor(color: Color): Color {
	return color === 'white' ? 'black' : 'white';
}

// ============================================================================
// Move Generation
// ============================================================================

/**
 * Generates all pseudo-legal moves for a piece at a given position
 * (Does not check if the move leaves own king in check)
 */
export function generatePieceMoves(state: GameState, pos: Position): Move[] {
	const piece = getPieceAt(state.board, pos);
	if (!piece || piece.color !== state.currentPlayer) {
		return [];
	}

	switch (piece.type) {
		case 'pawn':
			return generatePawnMoves(state, pos, piece.color);
		case 'knight':
			return generateKnightMoves(state, pos, piece.color);
		case 'bishop':
			return generateBishopMoves(state, pos, piece.color);
		case 'rook':
			return generateRookMoves(state, pos, piece.color);
		case 'queen':
			return generateQueenMoves(state, pos, piece.color);
		case 'king':
			return generateKingMoves(state, pos, piece.color);
		default:
			return [];
	}
}

/**
 * Generates all pawn moves from a position
 */
function generatePawnMoves(state: GameState, pos: Position, color: Color): Move[] {
	const moves: Move[] = [];
	const direction = color === 'white' ? 1 : -1;
	const startRank = color === 'white' ? 1 : 6;
	const promotionRank = color === 'white' ? 7 : 0;

	// Single push
	const singlePush: Position = { rank: pos.rank + direction, file: pos.file };
	if (isValidPosition(singlePush) && !getPieceAt(state.board, singlePush)) {
		if (singlePush.rank === promotionRank) {
			// Promotion moves - defensive player still prefers queen but is cautious
			for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as PieceType[]) {
				moves.push({ from: pos, to: singlePush, promotion });
			}
		} else {
			moves.push({ from: pos, to: singlePush });

			// Double push from starting position
			if (pos.rank === startRank) {
				const doublePush: Position = { rank: pos.rank + 2 * direction, file: pos.file };
				if (!getPieceAt(state.board, doublePush)) {
					moves.push({ from: pos, to: doublePush });
				}
			}
		}
	}

	// Captures (including en passant)
	for (const fileOffset of [-1, 1]) {
		const capturePos: Position = { rank: pos.rank + direction, file: pos.file + fileOffset };
		if (!isValidPosition(capturePos)) {
			continue;
		}

		const targetPiece = getPieceAt(state.board, capturePos);
		const isEnPassant = state.enPassantTarget &&
			capturePos.rank === state.enPassantTarget.rank &&
			capturePos.file === state.enPassantTarget.file;

		if ((targetPiece && targetPiece.color !== color) || isEnPassant) {
			if (capturePos.rank === promotionRank) {
				for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as PieceType[]) {
					moves.push({ from: pos, to: capturePos, promotion, isCapture: true, isEnPassant });
				}
			} else {
				moves.push({ from: pos, to: capturePos, isCapture: true, isEnPassant });
			}
		}
	}

	return moves;
}

/**
 * Generates all knight moves from a position
 */
function generateKnightMoves(state: GameState, pos: Position, color: Color): Move[] {
	const moves: Move[] = [];
	const offsets = [
		{ rank: 2, file: 1 }, { rank: 2, file: -1 },
		{ rank: -2, file: 1 }, { rank: -2, file: -1 },
		{ rank: 1, file: 2 }, { rank: 1, file: -2 },
		{ rank: -1, file: 2 }, { rank: -1, file: -2 },
	];

	for (const offset of offsets) {
		const newPos: Position = { rank: pos.rank + offset.rank, file: pos.file + offset.file };
		if (isValidPosition(newPos)) {
			const targetPiece = getPieceAt(state.board, newPos);
			if (!targetPiece || targetPiece.color !== color) {
				moves.push({
					from: pos,
					to: newPos,
					isCapture: targetPiece !== null,
				});
			}
		}
	}

	return moves;
}

/**
 * Generates sliding piece moves (for bishops, rooks, queens)
 */
function generateSlidingMoves(
	state: GameState,
	pos: Position,
	color: Color,
	directions: { rank: number; file: number }[]
): Move[] {
	const moves: Move[] = [];

	for (const dir of directions) {
		let currentPos: Position = { rank: pos.rank + dir.rank, file: pos.file + dir.file };

		while (isValidPosition(currentPos)) {
			const targetPiece = getPieceAt(state.board, currentPos);

			if (!targetPiece) {
				moves.push({ from: pos, to: currentPos });
			} else if (targetPiece.color !== color) {
				moves.push({ from: pos, to: currentPos, isCapture: true });
				break;
			} else {
				break;
			}

			currentPos = { rank: currentPos.rank + dir.rank, file: currentPos.file + dir.file };
		}
	}

	return moves;
}

/**
 * Generates all bishop moves from a position
 */
function generateBishopMoves(state: GameState, pos: Position, color: Color): Move[] {
	const diagonalDirs = [
		{ rank: 1, file: 1 }, { rank: 1, file: -1 },
		{ rank: -1, file: 1 }, { rank: -1, file: -1 },
	];
	return generateSlidingMoves(state, pos, color, diagonalDirs);
}

/**
 * Generates all rook moves from a position
 */
function generateRookMoves(state: GameState, pos: Position, color: Color): Move[] {
	const straightDirs = [
		{ rank: 1, file: 0 }, { rank: -1, file: 0 },
		{ rank: 0, file: 1 }, { rank: 0, file: -1 },
	];
	return generateSlidingMoves(state, pos, color, straightDirs);
}

/**
 * Generates all queen moves from a position
 */
function generateQueenMoves(state: GameState, pos: Position, color: Color): Move[] {
	const allDirs = [
		{ rank: 1, file: 0 }, { rank: -1, file: 0 },
		{ rank: 0, file: 1 }, { rank: 0, file: -1 },
		{ rank: 1, file: 1 }, { rank: 1, file: -1 },
		{ rank: -1, file: 1 }, { rank: -1, file: -1 },
	];
	return generateSlidingMoves(state, pos, color, allDirs);
}

/**
 * Generates all king moves from a position (including castling)
 */
function generateKingMoves(state: GameState, pos: Position, color: Color): Move[] {
	const moves: Move[] = [];
	const offsets = [
		{ rank: 1, file: 0 }, { rank: -1, file: 0 },
		{ rank: 0, file: 1 }, { rank: 0, file: -1 },
		{ rank: 1, file: 1 }, { rank: 1, file: -1 },
		{ rank: -1, file: 1 }, { rank: -1, file: -1 },
	];

	// Regular king moves
	for (const offset of offsets) {
		const newPos: Position = { rank: pos.rank + offset.rank, file: pos.file + offset.file };
		if (isValidPosition(newPos)) {
			const targetPiece = getPieceAt(state.board, newPos);
			if (!targetPiece || targetPiece.color !== color) {
				moves.push({
					from: pos,
					to: newPos,
					isCapture: targetPiece !== null,
				});
			}
		}
	}

	// Castling (simplified check - doesn't verify if squares are attacked)
	const baseRank = color === 'white' ? 0 : 7;
	if (pos.rank === baseRank && pos.file === 4) {
		const kingside = color === 'white' ? state.castlingRights.whiteKingside : state.castlingRights.blackKingside;
		const queenside = color === 'white' ? state.castlingRights.whiteQueenside : state.castlingRights.blackQueenside;

		if (kingside) {
			const f1 = getPieceAt(state.board, { rank: baseRank, file: 5 });
			const g1 = getPieceAt(state.board, { rank: baseRank, file: 6 });
			if (!f1 && !g1) {
				moves.push({ from: pos, to: { rank: baseRank, file: 6 }, isCastle: true });
			}
		}

		if (queenside) {
			const d1 = getPieceAt(state.board, { rank: baseRank, file: 3 });
			const c1 = getPieceAt(state.board, { rank: baseRank, file: 2 });
			const b1 = getPieceAt(state.board, { rank: baseRank, file: 1 });
			if (!d1 && !c1 && !b1) {
				moves.push({ from: pos, to: { rank: baseRank, file: 2 }, isCastle: true });
			}
		}
	}

	return moves;
}

/**
 * Generates all legal moves for the current player
 */
export function generateAllMoves(state: GameState): Move[] {
	const moves: Move[] = [];

	for (let rank = 0; rank < 8; rank++) {
		for (let file = 0; file < 8; file++) {
			const piece = state.board[rank][file];
			if (piece && piece.color === state.currentPlayer) {
				moves.push(...generatePieceMoves(state, { rank, file }));
			}
		}
	}

	// Filter out moves that leave own king in check
	return moves.filter(move => {
		const newState = applyMove(state, move);
		return !isKingInCheck(newState.board, state.currentPlayer);
	});
}

// ============================================================================
// Move Application
// ============================================================================

/**
 * Applies a move to the game state and returns the new state
 */
export function applyMove(state: GameState, move: Move): GameState {
	const newBoard = cloneBoard(state.board);
	const piece = newBoard[move.from.rank][move.from.file];

	if (!piece) {
		throw new Error('No piece at move source');
	}

	// Handle castling
	if (move.isCastle) {
		const isKingside = move.to.file === 6;
		const rookFromFile = isKingside ? 7 : 0;
		const rookToFile = isKingside ? 5 : 3;

		// Move king
		newBoard[move.to.rank][move.to.file] = piece;
		newBoard[move.from.rank][move.from.file] = null;

		// Move rook
		const rook = newBoard[move.from.rank][rookFromFile];
		newBoard[move.from.rank][rookToFile] = rook;
		newBoard[move.from.rank][rookFromFile] = null;
	}
	// Handle en passant
	else if (move.isEnPassant) {
		newBoard[move.to.rank][move.to.file] = piece;
		newBoard[move.from.rank][move.from.file] = null;
		// Remove captured pawn
		const capturedPawnRank = state.currentPlayer === 'white' ? move.to.rank - 1 : move.to.rank + 1;
		newBoard[capturedPawnRank][move.to.file] = null;
	}
	// Handle promotion
	else if (move.promotion) {
		newBoard[move.to.rank][move.to.file] = { type: move.promotion, color: piece.color };
		newBoard[move.from.rank][move.from.file] = null;
	}
	// Regular move
	else {
		newBoard[move.to.rank][move.to.file] = piece;
		newBoard[move.from.rank][move.from.file] = null;
	}

	// Update castling rights
	let newCastlingRights = { ...state.castlingRights };
	if (piece.type === 'king') {
		if (piece.color === 'white') {
			newCastlingRights.whiteKingside = false;
			newCastlingRights.whiteQueenside = false;
		} else {
			newCastlingRights.blackKingside = false;
			newCastlingRights.blackQueenside = false;
		}
	}
	if (piece.type === 'rook') {
		if (move.from.rank === 0 && move.from.file === 0) {
			newCastlingRights.whiteQueenside = false;
		}
		if (move.from.rank === 0 && move.from.file === 7) {
			newCastlingRights.whiteKingside = false;
		}
		if (move.from.rank === 7 && move.from.file === 0) {
			newCastlingRights.blackQueenside = false;
		}
		if (move.from.rank === 7 && move.from.file === 7) {
			newCastlingRights.blackKingside = false;
		}
	}

	// Update en passant target
	let newEnPassantTarget: Position | null = null;
	if (piece.type === 'pawn' && Math.abs(move.to.rank - move.from.rank) === 2) {
		newEnPassantTarget = {
			rank: (move.from.rank + move.to.rank) / 2,
			file: move.from.file,
		};
	}

	// Update move clocks
	const isCapture = move.isCapture || state.board[move.to.rank][move.to.file] !== null;
	const isPawnMove = piece.type === 'pawn';
	const newHalfMoveClock = (isCapture || isPawnMove) ? 0 : state.halfMoveClock + 1;
	const newFullMoveNumber = state.currentPlayer === 'black' ? state.fullMoveNumber + 1 : state.fullMoveNumber;

	return {
		board: newBoard,
		currentPlayer: getOpponentColor(state.currentPlayer),
		castlingRights: newCastlingRights,
		enPassantTarget: newEnPassantTarget,
		halfMoveClock: newHalfMoveClock,
		fullMoveNumber: newFullMoveNumber,
	};
}

// ============================================================================
// Check Detection
// ============================================================================

/**
 * Finds the king's position for a given color
 */
export function findKing(board: Board, color: Color): Position | null {
	for (let rank = 0; rank < 8; rank++) {
		for (let file = 0; file < 8; file++) {
			const piece = board[rank][file];
			if (piece && piece.type === 'king' && piece.color === color) {
				return { rank, file };
			}
		}
	}
	return null;
}

/**
 * Checks if a square is attacked by a given color
 */
export function isSquareAttacked(board: Board, pos: Position, byColor: Color): boolean {
	// Check pawn attacks
	const pawnDirection = byColor === 'white' ? 1 : -1;
	for (const fileOffset of [-1, 1]) {
		const attackerPos: Position = { rank: pos.rank - pawnDirection, file: pos.file + fileOffset };
		if (isValidPosition(attackerPos)) {
			const piece = getPieceAt(board, attackerPos);
			if (piece && piece.type === 'pawn' && piece.color === byColor) {
				return true;
			}
		}
	}

	// Check knight attacks
	const knightOffsets = [
		{ rank: 2, file: 1 }, { rank: 2, file: -1 },
		{ rank: -2, file: 1 }, { rank: -2, file: -1 },
		{ rank: 1, file: 2 }, { rank: 1, file: -2 },
		{ rank: -1, file: 2 }, { rank: -1, file: -2 },
	];
	for (const offset of knightOffsets) {
		const attackerPos: Position = { rank: pos.rank + offset.rank, file: pos.file + offset.file };
		if (isValidPosition(attackerPos)) {
			const piece = getPieceAt(board, attackerPos);
			if (piece && piece.type === 'knight' && piece.color === byColor) {
				return true;
			}
		}
	}

	// Check king attacks (for adjacent squares)
	const kingOffsets = [
		{ rank: 1, file: 0 }, { rank: -1, file: 0 },
		{ rank: 0, file: 1 }, { rank: 0, file: -1 },
		{ rank: 1, file: 1 }, { rank: 1, file: -1 },
		{ rank: -1, file: 1 }, { rank: -1, file: -1 },
	];
	for (const offset of kingOffsets) {
		const attackerPos: Position = { rank: pos.rank + offset.rank, file: pos.file + offset.file };
		if (isValidPosition(attackerPos)) {
			const piece = getPieceAt(board, attackerPos);
			if (piece && piece.type === 'king' && piece.color === byColor) {
				return true;
			}
		}
	}

	// Check sliding piece attacks (rook, bishop, queen)
	const directions = {
		straight: [{ rank: 1, file: 0 }, { rank: -1, file: 0 }, { rank: 0, file: 1 }, { rank: 0, file: -1 }],
		diagonal: [{ rank: 1, file: 1 }, { rank: 1, file: -1 }, { rank: -1, file: 1 }, { rank: -1, file: -1 }],
	};

	for (const dir of directions.straight) {
		let checkPos: Position = { rank: pos.rank + dir.rank, file: pos.file + dir.file };
		while (isValidPosition(checkPos)) {
			const piece = getPieceAt(board, checkPos);
			if (piece) {
				if (piece.color === byColor && (piece.type === 'rook' || piece.type === 'queen')) {
					return true;
				}
				break;
			}
			checkPos = { rank: checkPos.rank + dir.rank, file: checkPos.file + dir.file };
		}
	}

	for (const dir of directions.diagonal) {
		let checkPos: Position = { rank: pos.rank + dir.rank, file: pos.file + dir.file };
		while (isValidPosition(checkPos)) {
			const piece = getPieceAt(board, checkPos);
			if (piece) {
				if (piece.color === byColor && (piece.type === 'bishop' || piece.type === 'queen')) {
					return true;
				}
				break;
			}
			checkPos = { rank: checkPos.rank + dir.rank, file: checkPos.file + dir.file };
		}
	}

	return false;
}

/**
 * Checks if a king of the given color is in check
 */
export function isKingInCheck(board: Board, kingColor: Color): boolean {
	const kingPos = findKing(board, kingColor);
	if (!kingPos) {
		return false;
	}
	return isSquareAttacked(board, kingPos, getOpponentColor(kingColor));
}

// ============================================================================
// Defensive Evaluation Functions
// ============================================================================

/**
 * Evaluates king safety - the core of defensive play
 */
function evaluateKingSafety(board: Board, color: Color, castlingRights: CastlingRights): number {
	let score = 0;
	const kingPos = findKing(board, color);
	if (!kingPos) {
		return 0;
	}

	const baseRank = color === 'white' ? 0 : 7;
	const opponentColor = getOpponentColor(color);

	// Check if king has castled (is on g1/c1 or g8/c8)
	const hasCastledKingside = kingPos.rank === baseRank && kingPos.file === 6;
	const hasCastledQueenside = kingPos.rank === baseRank && kingPos.file === 2;

	if (hasCastledKingside || hasCastledQueenside) {
		score += CASTLED_KING_BONUS;
	}

	// Penalty for king in center (very bad for defensive play!)
	const isInCenter = kingPos.file >= 2 && kingPos.file <= 5 && kingPos.rank === baseRank;
	if (isInCenter && !hasCastledKingside && !hasCastledQueenside) {
		// Check if castling is still available
		const canCastleKingside = color === 'white' ? castlingRights.whiteKingside : castlingRights.blackKingside;
		const canCastleQueenside = color === 'white' ? castlingRights.whiteQueenside : castlingRights.blackQueenside;

		if (!canCastleKingside && !canCastleQueenside) {
			score += KING_CENTER_PENALTY;
		}
	}

	// Evaluate pawn shield (pawns in front of castled king)
	if (hasCastledKingside) {
		const shieldRank = color === 'white' ? 1 : 6;
		const shieldFiles = [5, 6, 7]; // f, g, h files
		for (const file of shieldFiles) {
			const pawn = getPieceAt(board, { rank: shieldRank, file });
			if (pawn && pawn.type === 'pawn' && pawn.color === color) {
				score += PAWN_SHIELD_BONUS;
			}
		}
	} else if (hasCastledQueenside) {
		const shieldRank = color === 'white' ? 1 : 6;
		const shieldFiles = [0, 1, 2]; // a, b, c files
		for (const file of shieldFiles) {
			const pawn = getPieceAt(board, { rank: shieldRank, file });
			if (pawn && pawn.type === 'pawn' && pawn.color === color) {
				score += PAWN_SHIELD_BONUS;
			}
		}
	}

	// Penalty for squares around king being attacked by opponent
	const kingOffsets = [
		{ rank: 1, file: 0 }, { rank: -1, file: 0 },
		{ rank: 0, file: 1 }, { rank: 0, file: -1 },
		{ rank: 1, file: 1 }, { rank: 1, file: -1 },
		{ rank: -1, file: 1 }, { rank: -1, file: -1 },
	];

	let attackedSquares = 0;
	for (const offset of kingOffsets) {
		const adjacentPos = { rank: kingPos.rank + offset.rank, file: kingPos.file + offset.file };
		if (isValidPosition(adjacentPos) && isSquareAttacked(board, adjacentPos, opponentColor)) {
			attackedSquares++;
		}
	}
	if (attackedSquares >= 3) {
		score += EXPOSED_KING_PENALTY;
	}

	return score;
}

/**
 * Evaluates pawn structure - defensive players love solid structures
 */
function evaluatePawnStructure(board: Board, color: Color): number {
	let score = 0;

	// Find all pawns of the color
	const pawns: Position[] = [];
	for (let rank = 0; rank < 8; rank++) {
		for (let file = 0; file < 8; file++) {
			const piece = board[rank][file];
			if (piece && piece.type === 'pawn' && piece.color === color) {
				pawns.push({ rank, file });
			}
		}
	}

	// Check for pawn chains (pawns defending each other)
	for (const pawn of pawns) {
		const direction = color === 'white' ? -1 : 1;

		// Check if this pawn is defended by another pawn
		for (const fileOffset of [-1, 1]) {
			const defenderPos: Position = { rank: pawn.rank + direction, file: pawn.file + fileOffset };
			if (isValidPosition(defenderPos)) {
				const defender = getPieceAt(board, defenderPos);
				if (defender && defender.type === 'pawn' && defender.color === color) {
					score += PAWN_CHAIN_BONUS;
				}
			}
		}
	}

	// Check for isolated pawns (no friendly pawns on adjacent files)
	for (const pawn of pawns) {
		let hasNeighbor = false;
		for (const fileOffset of [-1, 1]) {
			const adjacentFile = pawn.file + fileOffset;
			if (adjacentFile >= 0 && adjacentFile < 8) {
				for (let rank = 0; rank < 8; rank++) {
					const piece = board[rank][adjacentFile];
					if (piece && piece.type === 'pawn' && piece.color === color) {
						hasNeighbor = true;
						break;
					}
				}
			}
			if (hasNeighbor) {
				break;
			}
		}
		if (!hasNeighbor) {
			score += ISOLATED_PAWN_PENALTY;
		}
	}

	// Check for doubled pawns
	for (let file = 0; file < 8; file++) {
		let pawnsOnFile = 0;
		for (let rank = 0; rank < 8; rank++) {
			const piece = board[rank][file];
			if (piece && piece.type === 'pawn' && piece.color === color) {
				pawnsOnFile++;
			}
		}
		if (pawnsOnFile > 1) {
			score += DOUBLED_PAWN_PENALTY * (pawnsOnFile - 1);
		}
	}

	// Check for backward pawns (can't be defended by other pawns and are blocked)
	for (const pawn of pawns) {
		const direction = color === 'white' ? 1 : -1;
		const startRank = color === 'white' ? 1 : 6;

		// Pawn hasn't moved much and check if it's backward
		if (Math.abs(pawn.rank - startRank) <= 1) {
			continue; // Not backward if still near start
		}

		// Check if there's a pawn in front blocking
		const inFrontPos: Position = { rank: pawn.rank + direction, file: pawn.file };
		if (!isValidPosition(inFrontPos)) {
			continue;
		}
		const inFront = getPieceAt(board, inFrontPos);
		if (inFront && inFront.type === 'pawn') {
			// Check if it can be defended
			let canBeDefended = false;
			for (const fileOffset of [-1, 1]) {
				const behindPos: Position = { rank: pawn.rank - direction, file: pawn.file + fileOffset };
				if (isValidPosition(behindPos)) {
					const behindPiece = getPieceAt(board, behindPos);
					if (behindPiece && behindPiece.type === 'pawn' && behindPiece.color === color) {
						canBeDefended = true;
						break;
					}
				}
			}
			if (!canBeDefended) {
				score += BACKWARD_PAWN_PENALTY;
			}
		}
	}

	return score;
}

/**
 * Evaluates piece positioning for defensive play
 */
function evaluatePiecePositioning(board: Board, color: Color): number {
	let score = 0;
	const baseRank = color === 'white' ? 0 : 7;
	const secondRank = color === 'white' ? 1 : 6;
	const thirdRank = color === 'white' ? 2 : 5;

	// Ideal knight squares for defense (f3/c3 for white, f6/c6 for black)
	const idealKnightSquares: Position[] = [
		{ rank: thirdRank - (color === 'white' ? 1 : -1), file: 2 }, // c3 or c6
		{ rank: thirdRank - (color === 'white' ? 1 : -1), file: 5 }, // f3 or f6
	];

	for (let rank = 0; rank < 8; rank++) {
		for (let file = 0; file < 8; file++) {
			const piece = board[rank][file];
			if (!piece || piece.color !== color) {
				continue;
			}

			const pos: Position = { rank, file };

			switch (piece.type) {
				case 'knight':
					// Bonus for knights on ideal defensive squares
					for (const ideal of idealKnightSquares) {
						if (pos.rank === ideal.rank && pos.file === ideal.file) {
							score += KNIGHT_IDEAL_SQUARE_BONUS;
						}
					}
					// Penalty for overextended knights
					const knightAdvancement = color === 'white' ? rank : 7 - rank;
					if (knightAdvancement > 4) {
						score += OVEREXTENSION_PENALTY;
					}
					break;

				case 'bishop':
					// Bonus for bishops on long diagonals protecting king area
					const bishopAdvancement = color === 'white' ? rank : 7 - rank;
					if (bishopAdvancement <= 3) {
						// Bishop is in defensive position
						score += BISHOP_PROTECTION_BONUS;
					}
					if (bishopAdvancement > 5) {
						score += OVEREXTENSION_PENALTY;
					}
					break;

				case 'rook':
					// Rooks are best on the back rank or second rank for defense
					if (rank === baseRank || rank === secondRank) {
						score += PIECE_COORDINATION_BONUS;
					}
					break;

				case 'queen':
					// Queen should not be too far advanced for defensive play
					const queenAdvancement = color === 'white' ? rank : 7 - rank;
					if (queenAdvancement > 4) {
						score += OVEREXTENSION_PENALTY * 2; // Double penalty for exposed queen
					}
					break;
			}
		}
	}

	return score;
}

/**
 * Evaluates if a position is closed (defensive players prefer closed positions)
 */
function evaluatePositionType(board: Board): number {
	let closedScore = 0;

	// Count pawns that are locked (can't move forward due to enemy pawn)
	for (let file = 0; file < 8; file++) {
		for (let rank = 1; rank < 7; rank++) {
			const piece = board[rank][file];
			if (!piece || piece.type !== 'pawn') {
				continue;
			}

			const direction = piece.color === 'white' ? 1 : -1;
			const inFrontPos: Position = { rank: rank + direction, file };
			const inFront = getPieceAt(board, inFrontPos);

			if (inFront && inFront.type === 'pawn' && inFront.color !== piece.color) {
				closedScore += CLOSED_POSITION_BONUS;
			}
		}
	}

	// Also check for central pawn chains (more closed = better for defense)
	for (let file = 2; file <= 5; file++) {
		for (let rank = 3; rank <= 4; rank++) {
			const piece = board[rank][file];
			if (piece && piece.type === 'pawn') {
				closedScore += CLOSED_POSITION_BONUS / 2;
			}
		}
	}

	return closedScore;
}

/**
 * Evaluates piece coordination (pieces defending each other)
 */
function evaluatePieceCoordination(state: GameState, color: Color): number {
	let score = 0;

	for (let rank = 0; rank < 8; rank++) {
		for (let file = 0; file < 8; file++) {
			const piece = state.board[rank][file];
			if (!piece || piece.color !== color || piece.type === 'pawn' || piece.type === 'king') {
				continue;
			}

			const pos: Position = { rank, file };

			// Check if this piece is defended by another piece
			if (isSquareAttacked(state.board, pos, color)) {
				score += PIECE_COORDINATION_BONUS;
			}
		}
	}

	return score;
}

/**
 * DEFENSIVE evaluation function that rewards:
 * - King safety and castling
 * - Strong pawn structures
 * - Defensive piece positioning
 * - Piece coordination
 * - Closed positions
 * - Conservative play
 */
export function evaluatePosition(state: GameState): number {
	const board = state.board;
	let score = 0;

	// Material evaluation (same as aggressive, but slightly less weight on activity)
	for (let rank = 0; rank < 8; rank++) {
		for (let file = 0; file < 8; file++) {
			const piece = board[rank][file];
			if (piece) {
				const sign = piece.color === 'white' ? 1 : -1;
				score += sign * PIECE_VALUES[piece.type];
			}
		}
	}

	// King safety (MOST IMPORTANT for defensive player)
	score += evaluateKingSafety(board, 'white', state.castlingRights);
	score -= evaluateKingSafety(board, 'black', state.castlingRights);

	// Pawn structure
	score += evaluatePawnStructure(board, 'white');
	score -= evaluatePawnStructure(board, 'black');

	// Piece positioning
	score += evaluatePiecePositioning(board, 'white');
	score -= evaluatePiecePositioning(board, 'black');

	// Position type (defensive player prefers closed positions)
	score += evaluatePositionType(board);

	// Piece coordination
	score += evaluatePieceCoordination(state, 'white');
	score -= evaluatePieceCoordination(state, 'black');

	// Central control (but not overextension)
	const centerSquares: Position[] = [
		{ rank: 3, file: 3 }, { rank: 3, file: 4 },
		{ rank: 4, file: 3 }, { rank: 4, file: 4 },
	];

	for (const square of centerSquares) {
		const piece = getPieceAt(board, square);
		if (piece && piece.type === 'pawn') {
			const sign = piece.color === 'white' ? 1 : -1;
			score += sign * CENTRAL_CONTROL_BONUS;
		}
	}

	return score;
}

/**
 * Evaluates if a capture is safe (won't lead to material loss)
 */
function isExchangeSafe(state: GameState, move: Move): boolean {
	if (!move.isCapture) {
		return true;
	}

	const movingPiece = getPieceAt(state.board, move.from);
	const targetPiece = getPieceAt(state.board, move.to);

	if (!movingPiece || !targetPiece) {
		return true;
	}

	// Always capture if target is more valuable
	if (PIECE_VALUES[targetPiece.type] > PIECE_VALUES[movingPiece.type]) {
		return true;
	}

	// Check if the square is defended
	const newState = applyMove(state, move);
	if (isSquareAttacked(newState.board, move.to, getOpponentColor(state.currentPlayer))) {
		// The square is defended - only trade if equal value or better
		if (PIECE_VALUES[targetPiece.type] < PIECE_VALUES[movingPiece.type]) {
			return false; // Don't trade down
		}
	}

	return true;
}

// ============================================================================
// Minimax Search with Alpha-Beta Pruning (Defensive variant)
// ============================================================================

/**
 * Minimax search with alpha-beta pruning
 * Defensive player is more cautious and doesn't extend on captures
 */
function minimax(
	state: GameState,
	depth: number,
	alpha: number,
	beta: number,
	maximizingPlayer: boolean
): number {
	// Terminal conditions
	if (depth === 0) {
		return evaluatePosition(state);
	}

	const moves = generateAllMoves(state);

	// Checkmate or stalemate
	if (moves.length === 0) {
		if (isKingInCheck(state.board, state.currentPlayer)) {
			// Checkmate - worst possible score
			return maximizingPlayer ? -Infinity : Infinity;
		}
		// Stalemate - defensive player might prefer this to losing
		return 0;
	}

	// Sort moves for better alpha-beta pruning
	// Defensive player prefers: castling > non-captures > safe captures > risky captures
	const sortedMoves = moves.sort((a, b) => {
		// Castling is always preferred
		if (a.isCastle && !b.isCastle) {
			return -1;
		}
		if (!a.isCastle && b.isCastle) {
			return 1;
		}

		// Non-captures before captures (conservative)
		if (!a.isCapture && b.isCapture) {
			return -1;
		}
		if (a.isCapture && !b.isCapture) {
			return 1;
		}

		// Safe captures before risky ones
		if (a.isCapture && b.isCapture) {
			const aSafe = isExchangeSafe(state, a) ? 1 : 0;
			const bSafe = isExchangeSafe(state, b) ? 1 : 0;
			return bSafe - aSafe;
		}

		return 0;
	});

	if (maximizingPlayer) {
		let maxEval = -Infinity;
		for (const move of sortedMoves) {
			const newState = applyMove(state, move);
			const evaluation = minimax(newState, depth - 1, alpha, beta, false);
			maxEval = Math.max(maxEval, evaluation);
			alpha = Math.max(alpha, evaluation);
			if (beta <= alpha) {
				break; // Beta cutoff
			}
		}
		return maxEval;
	} else {
		let minEval = Infinity;
		for (const move of sortedMoves) {
			const newState = applyMove(state, move);
			const evaluation = minimax(newState, depth - 1, alpha, beta, true);
			minEval = Math.min(minEval, evaluation);
			beta = Math.min(beta, evaluation);
			if (beta <= alpha) {
				break; // Alpha cutoff
			}
		}
		return minEval;
	}
}

// ============================================================================
// Main Chess Player Interface
// ============================================================================

/**
 * Defensive chess player that finds the best move for the current position
 *
 * @param state - Current game state
 * @param searchDepth - Optional search depth override (default: SEARCH_DEPTH)
 * @returns The best move according to defensive strategy, or null if no moves available
 */
export function findBestMove(state: GameState, searchDepth: number = SEARCH_DEPTH): Move | null {
	const moves = generateAllMoves(state);

	if (moves.length === 0) {
		return null;
	}

	const scoredMoves: ScoredMove[] = [];
	const isMaximizing = state.currentPlayer === 'white';

	for (const move of moves) {
		const newState = applyMove(state, move);

		// Calculate move-specific bonuses for defensive play
		let moveBonus = 0;

		// HUGE bonus for castling (defensive priority #1)
		if (move.isCastle) {
			moveBonus += CASTLED_KING_BONUS * 2;
		}

		// Penalty for risky exchanges
		if (move.isCapture && !isExchangeSafe(state, move)) {
			moveBonus += RISKY_EXCHANGE_PENALTY;
		}

		// Bonus for moves that improve king safety
		const kingSafetyBefore = evaluateKingSafety(state.board, state.currentPlayer, state.castlingRights);
		const kingSafetyAfter = evaluateKingSafety(newState.board, state.currentPlayer, newState.castlingRights);
		moveBonus += (kingSafetyAfter - kingSafetyBefore) * 0.5;

		// Bonus for moves that improve pawn structure
		const pawnStructureBefore = evaluatePawnStructure(state.board, state.currentPlayer);
		const pawnStructureAfter = evaluatePawnStructure(newState.board, state.currentPlayer);
		moveBonus += (pawnStructureAfter - pawnStructureBefore) * 0.3;

		const score = minimax(newState, searchDepth - 1, -Infinity, Infinity, !isMaximizing);
		scoredMoves.push({
			move,
			score: isMaximizing ? score + moveBonus : score - moveBonus,
		});
	}

	// Sort moves by score
	scoredMoves.sort((a, b) => {
		return isMaximizing ? b.score - a.score : a.score - b.score;
	});

	// Return the best move
	return scoredMoves[0]?.move ?? null;
}

/**
 * Converts a position to algebraic notation (e.g., {rank: 0, file: 0} -> "a1")
 */
export function positionToAlgebraic(pos: Position): string {
	const file = String.fromCharCode('a'.charCodeAt(0) + pos.file);
	const rank = (pos.rank + 1).toString();
	return file + rank;
}

/**
 * Converts a move to algebraic notation (e.g., "e2e4")
 */
export function moveToAlgebraic(move: Move): string {
	let notation = positionToAlgebraic(move.from) + positionToAlgebraic(move.to);
	if (move.promotion) {
		const promotionChar = move.promotion === 'knight' ? 'n' : move.promotion[0];
		notation += promotionChar;
	}
	return notation;
}

/**
 * Parses algebraic notation to a position
 */
export function algebraicToPosition(algebraic: string): Position {
	const file = algebraic.charCodeAt(0) - 'a'.charCodeAt(0);
	const rank = parseInt(algebraic[1]) - 1;
	return { rank, file };
}

/**
 * Parses algebraic move notation to a Move object
 */
export function algebraicToMove(algebraic: string, state: GameState): Move | null {
	if (algebraic.length < 4) {
		return null;
	}

	const from = algebraicToPosition(algebraic.substring(0, 2));
	const to = algebraicToPosition(algebraic.substring(2, 4));

	const piece = getPieceAt(state.board, from);
	if (!piece) {
		return null;
	}

	const targetPiece = getPieceAt(state.board, to);

	// Check for promotion
	let promotion: PieceType | undefined;
	if (algebraic.length === 5) {
		const promotionChar = algebraic[4].toLowerCase();
		const promotionMap: Record<string, PieceType> = {
			'q': 'queen',
			'r': 'rook',
			'b': 'bishop',
			'n': 'knight',
		};
		promotion = promotionMap[promotionChar];
	}

	// Check for castling
	const isCastle = piece.type === 'king' && Math.abs(to.file - from.file) === 2;

	// Check for en passant
	const isEnPassant = piece.type === 'pawn' &&
		from.file !== to.file &&
		!targetPiece &&
		state.enPassantTarget &&
		to.rank === state.enPassantTarget.rank &&
		to.file === state.enPassantTarget.file;

	return {
		from,
		to,
		promotion,
		isCapture: targetPiece !== null || isEnPassant,
		isCastle,
		isEnPassant,
	};
}

/**
 * Pretty prints the current board state
 */
export function printBoard(board: Board): string {
	const pieceSymbols: Record<PieceType, string> = {
		king: 'K',
		queen: 'Q',
		rook: 'R',
		bishop: 'B',
		knight: 'N',
		pawn: 'P',
	};

	let output = '  a b c d e f g h\n';

	for (let rank = 7; rank >= 0; rank--) {
		output += (rank + 1) + ' ';
		for (let file = 0; file < 8; file++) {
			const piece = board[rank][file];
			if (piece) {
				const symbol = pieceSymbols[piece.type];
				output += (piece.color === 'white' ? symbol : symbol.toLowerCase()) + ' ';
			} else {
				output += '. ';
			}
		}
		output += (rank + 1) + '\n';
	}

	output += '  a b c d e f g h';
	return output;
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example: Play a game with a defensive player
 */
export function playDefensiveGame(maxMoves: number = 100): void {
	let state = createInitialGameState();

	console.log('Starting Defensive Chess Game!\n');
	console.log(printBoard(state.board));
	console.log('\n');

	for (let moveNum = 1; moveNum <= maxMoves; moveNum++) {
		const move = findBestMove(state);

		if (!move) {
			const inCheck = isKingInCheck(state.board, state.currentPlayer);
			if (inCheck) {
				console.log(`Checkmate! ${getOpponentColor(state.currentPlayer)} wins!`);
			} else {
				console.log('Stalemate!');
			}
			break;
		}

		const moveNotation = moveToAlgebraic(move);
		state = applyMove(state, move);

		console.log(`Move ${moveNum}: ${state.currentPlayer === 'black' ? 'White' : 'Black'} plays ${moveNotation}`);

		if (move.isCastle) {
			console.log('Castled! King is safe.');
		}

		if (isKingInCheck(state.board, state.currentPlayer)) {
			console.log('Check!');
		}

		console.log(printBoard(state.board));
		console.log('\n');
	}
}
