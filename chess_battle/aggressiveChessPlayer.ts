/**
 * Aggressive Chess Player Implementation
 *
 * This module implements an aggressive chess playing strategy that prioritizes:
 * - Attacking moves and capturing opponent pieces
 * - Piece development towards the center and opponent's territory
 * - Tactical combinations and sacrifices
 * - Open positions and active piece play
 */

// ============================================================================
// Types and Interfaces
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
// Constants
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

/** Bonus for controlling center squares (d4, d5, e4, e5) */
const CENTER_CONTROL_BONUS = 30;

/** Extended center squares (c3-f6) bonus */
const EXTENDED_CENTER_BONUS = 15;

/** Bonus for pieces on opponent's side of the board */
const ADVANCEMENT_BONUS_PER_RANK = 10;

/** Bonus for attacking enemy pieces */
const ATTACK_BONUS = 25;

/** Bonus for having open files for rooks */
const OPEN_FILE_BONUS = 40;

/** Bonus for bishop pair */
const BISHOP_PAIR_BONUS = 50;

/** Penalty for doubled pawns */
const DOUBLED_PAWN_PENALTY = -20;

/** Bonus for passed pawns */
const PASSED_PAWN_BONUS = 50;

/** Aggression multiplier for captures */
const CAPTURE_AGGRESSION_BONUS = 1.2;

/** Bonus for checks */
const CHECK_BONUS = 30;

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
			// Promotion moves - aggressive player prefers queen
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
// Aggressive Evaluation Function
// ============================================================================

/**
 * Counts how many squares a piece attacks
 */
function countAttackedSquares(state: GameState, pos: Position): number {
	const moves = generatePieceMoves(state, pos);
	return moves.length;
}

/**
 * Evaluates if a pawn is a passed pawn
 */
function isPassedPawn(board: Board, pos: Position, color: Color): boolean {
	const direction = color === 'white' ? 1 : -1;
	const endRank = color === 'white' ? 7 : 0;

	// Check if there are any opponent pawns that can block or capture this pawn
	for (let rank = pos.rank + direction; rank !== endRank + direction; rank += direction) {
		for (let file = Math.max(0, pos.file - 1); file <= Math.min(7, pos.file + 1); file++) {
			const piece = board[rank][file];
			if (piece && piece.type === 'pawn' && piece.color !== color) {
				return false;
			}
		}
	}
	return true;
}

/**
 * Counts doubled pawns for a color
 */
function countDoubledPawns(board: Board, color: Color): number {
	let doubled = 0;

	for (let file = 0; file < 8; file++) {
		let pawnsOnFile = 0;
		for (let rank = 0; rank < 8; rank++) {
			const piece = board[rank][file];
			if (piece && piece.type === 'pawn' && piece.color === color) {
				pawnsOnFile++;
			}
		}
		if (pawnsOnFile > 1) {
			doubled += pawnsOnFile - 1;
		}
	}

	return doubled;
}

/**
 * Checks if a file is open (no pawns)
 */
function isOpenFile(board: Board, file: number): boolean {
	for (let rank = 0; rank < 8; rank++) {
		const piece = board[rank][file];
		if (piece && piece.type === 'pawn') {
			return false;
		}
	}
	return true;
}

/**
 * AGGRESSIVE evaluation function that rewards:
 * - Material advantage
 * - Central control
 * - Piece activity and mobility
 * - Attacking opponent pieces
 * - Advanced pawns
 * - Checks
 */
export function evaluatePosition(state: GameState): number {
	const board = state.board;
	let score = 0;

	let whiteBishops = 0;
	let blackBishops = 0;

	for (let rank = 0; rank < 8; rank++) {
		for (let file = 0; file < 8; file++) {
			const piece = board[rank][file];
			if (!piece) {
				continue;
			}

			const sign = piece.color === 'white' ? 1 : -1;
			const pos: Position = { rank, file };

			// Material value
			score += sign * PIECE_VALUES[piece.type];

			// Count bishops for bishop pair bonus
			if (piece.type === 'bishop') {
				if (piece.color === 'white') {
					whiteBishops++;
				} else {
					blackBishops++;
				}
			}

			// Center control bonus (aggressive players love the center!)
			const isCenterSquare = (rank === 3 || rank === 4) && (file === 3 || file === 4);
			const isExtendedCenter = rank >= 2 && rank <= 5 && file >= 2 && file <= 5;

			if (isCenterSquare) {
				score += sign * CENTER_CONTROL_BONUS;
			} else if (isExtendedCenter) {
				score += sign * EXTENDED_CENTER_BONUS;
			}

			// Piece advancement bonus (push forward aggressively!)
			const advancementRank = piece.color === 'white' ? rank : 7 - rank;
			if (piece.type !== 'king') {
				score += sign * (advancementRank * ADVANCEMENT_BONUS_PER_RANK);
			}

			// Piece mobility (more squares attacked = more aggressive)
			if (piece.color === state.currentPlayer) {
				const mobility = countAttackedSquares(state, pos);
				score += sign * (mobility * 5); // 5 points per available move
			}

			// Passed pawn bonus
			if (piece.type === 'pawn' && isPassedPawn(board, pos, piece.color)) {
				score += sign * (PASSED_PAWN_BONUS + advancementRank * 10);
			}

			// Rook on open file bonus
			if (piece.type === 'rook' && isOpenFile(board, file)) {
				score += sign * OPEN_FILE_BONUS;
			}
		}
	}

	// Bishop pair bonus
	if (whiteBishops >= 2) {
		score += BISHOP_PAIR_BONUS;
	}
	if (blackBishops >= 2) {
		score -= BISHOP_PAIR_BONUS;
	}

	// Doubled pawn penalty
	score += countDoubledPawns(board, 'white') * DOUBLED_PAWN_PENALTY;
	score -= countDoubledPawns(board, 'black') * DOUBLED_PAWN_PENALTY;

	// Check bonus (aggressive player loves giving checks!)
	if (isKingInCheck(board, 'black')) {
		score += CHECK_BONUS;
	}
	if (isKingInCheck(board, 'white')) {
		score -= CHECK_BONUS;
	}

	// Attack bonus - count attacks on opponent pieces
	const attackBonus = calculateAttackBonus(state);
	score += attackBonus;

	return score;
}

/**
 * Calculates bonus for attacking opponent's pieces
 */
function calculateAttackBonus(state: GameState): number {
	let bonus = 0;

	for (let rank = 0; rank < 8; rank++) {
		for (let file = 0; file < 8; file++) {
			const piece = state.board[rank][file];
			if (!piece || piece.color !== state.currentPlayer) {
				continue;
			}

			const moves = generatePieceMoves(state, { rank, file });
			for (const move of moves) {
				if (move.isCapture) {
					const targetPiece = getPieceAt(state.board, move.to);
					if (targetPiece) {
						// Bonus proportional to the value of the piece being attacked
						bonus += (PIECE_VALUES[targetPiece.type] / 10) * CAPTURE_AGGRESSION_BONUS;
					}
				}
			}
		}
	}

	return state.currentPlayer === 'white' ? bonus : -bonus;
}

// ============================================================================
// Minimax Search with Alpha-Beta Pruning
// ============================================================================

/**
 * Minimax search with alpha-beta pruning
 * Aggressive player searches deeper on captures
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
		// Stalemate
		return 0;
	}

	// Sort moves to search captures first (for better alpha-beta pruning)
	const sortedMoves = moves.sort((a, b) => {
		// Captures first, then checks
		const aCapture = a.isCapture ? 1 : 0;
		const bCapture = b.isCapture ? 1 : 0;
		return bCapture - aCapture;
	});

	if (maximizingPlayer) {
		let maxEval = -Infinity;
		for (const move of sortedMoves) {
			const newState = applyMove(state, move);
			// Quiescence search: extend depth for captures
			const extension = move.isCapture ? 1 : 0;
			const evaluation = minimax(newState, depth - 1 + Math.min(extension, depth > 1 ? 1 : 0), alpha, beta, false);
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
			const extension = move.isCapture ? 1 : 0;
			const evaluation = minimax(newState, depth - 1 + Math.min(extension, depth > 1 ? 1 : 0), alpha, beta, true);
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
 * Aggressive chess player that finds the best move for the current position
 *
 * @param state - Current game state
 * @param searchDepth - Optional search depth override (default: SEARCH_DEPTH)
 * @returns The best move according to aggressive strategy, or null if no moves available
 */
export function findBestMove(state: GameState, searchDepth: number = SEARCH_DEPTH): Move | null {
	const moves = generateAllMoves(state);

	if (moves.length === 0) {
		return null;
	}

	// Sort moves to prioritize aggressive moves
	const scoredMoves: ScoredMove[] = [];
	const isMaximizing = state.currentPlayer === 'white';

	for (const move of moves) {
		const newState = applyMove(state, move);

		// Add capture bonus to move ordering (aggressive preference)
		let moveBonus = 0;
		if (move.isCapture) {
			const targetPiece = getPieceAt(state.board, move.to);
			if (targetPiece) {
				moveBonus = PIECE_VALUES[targetPiece.type] * CAPTURE_AGGRESSION_BONUS;
			}
		}

		// Check if move gives check (aggressive!)
		if (isKingInCheck(newState.board, getOpponentColor(state.currentPlayer))) {
			moveBonus += CHECK_BONUS;
		}

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
 * Example: Play a game between two aggressive players
 */
export function playAggressiveGame(maxMoves: number = 100): void {
	let state = createInitialGameState();

	console.log('Starting Aggressive Chess Game!\n');
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

		if (isKingInCheck(state.board, state.currentPlayer)) {
			console.log('Check!');
		}

		console.log(printBoard(state.board));
		console.log('\n');
	}
}
