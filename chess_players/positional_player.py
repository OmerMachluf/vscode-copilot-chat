"""
Positional/Defensive Chess Player Strategy

This chess player implements a POSITIONAL/DEFENSIVE strategy that focuses on:
1. Piece safety and solid pawn structure
2. Early piece development and castling
3. Piece coordination and control of key squares
4. King safety as a primary concern

The evaluation function scores positions based on:
- Material balance
- Piece activity and mobility
- Pawn structure quality
- King safety
- Control of center squares
- Piece coordination

Uses minimax algorithm with alpha-beta pruning at depth 3-4 for move selection.
"""

import chess
from typing import Optional, Tuple, List
from dataclasses import dataclass


# Piece values for material evaluation (in centipawns)
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000
}

# Piece-square tables for positional evaluation
# These tables encourage pieces to move to strong squares
# Values are from White's perspective (flipped for Black)

# Pawns: Encourage central pawns and advancement (but not premature advancement)
PAWN_TABLE = [
    0,   0,   0,   0,   0,   0,   0,   0,
    50,  50,  50,  50,  50,  50,  50,  50,
    10,  10,  20,  30,  30,  20,  10,  10,
    5,   5,  10,  25,  25,  10,   5,   5,
    0,   0,   0,  20,  20,   0,   0,   0,
    5,  -5, -10,   0,   0, -10,  -5,   5,
    5,  10,  10, -20, -20,  10,  10,   5,
    0,   0,   0,   0,   0,   0,   0,   0
]

# Knights: Prefer central squares, avoid edges
KNIGHT_TABLE = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50
]

# Bishops: Prefer long diagonals and avoid corners
BISHOP_TABLE = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20
]

# Rooks: Prefer open files and 7th rank
ROOK_TABLE = [
    0,   0,   0,   0,   0,   0,   0,   0,
    5,  10,  10,  10,  10,  10,  10,   5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    0,   0,   0,   5,   5,   0,   0,   0
]

# Queen: Slightly prefer central squares but avoid early development
QUEEN_TABLE = [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
    -5,   0,   5,   5,   5,   5,   0,  -5,
    0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20
]

# King middle game: Encourage castling and staying safe
KING_MIDDLE_TABLE = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20,  20,   0,   0,   0,   0,  20,  20,
    20,  30,  10,   0,   0,  10,  30,  20
]

# King endgame: Encourage centralization
KING_END_TABLE = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10,   0,   0, -10, -20, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -30,   0,   0,   0,   0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50
]

# Piece-square tables dictionary
PIECE_SQUARE_TABLES = {
    chess.PAWN: PAWN_TABLE,
    chess.KNIGHT: KNIGHT_TABLE,
    chess.BISHOP: BISHOP_TABLE,
    chess.ROOK: ROOK_TABLE,
    chess.QUEEN: QUEEN_TABLE,
    chess.KING: KING_MIDDLE_TABLE  # Use middle game table by default
}

# Central squares for evaluation
CENTER_SQUARES = [chess.D4, chess.D5, chess.E4, chess.E5]
EXTENDED_CENTER = [
    chess.C3, chess.C4, chess.C5, chess.C6,
    chess.D3, chess.D4, chess.D5, chess.D6,
    chess.E3, chess.E4, chess.E5, chess.E6,
    chess.F3, chess.F4, chess.F5, chess.F6
]


@dataclass
class PositionalEvaluation:
    """Detailed breakdown of positional evaluation components."""
    material: int = 0
    piece_position: int = 0
    mobility: int = 0
    pawn_structure: int = 0
    king_safety: int = 0
    development: int = 0
    center_control: int = 0
    
    @property
    def total(self) -> int:
        return (
            self.material +
            self.piece_position +
            self.mobility +
            self.pawn_structure +
            self.king_safety +
            self.development +
            self.center_control
        )


class PositionalPlayer:
    """
    A chess player that uses positional/defensive strategy.
    
    Strategy principles:
    1. SAFETY FIRST: Prioritize king safety and piece protection
    2. SOLID STRUCTURE: Maintain healthy pawn structure
    3. DEVELOPMENT: Complete piece development before attacking
    4. COORDINATION: Ensure pieces work together harmoniously
    5. CENTER CONTROL: Control key central squares
    """
    
    def __init__(self, depth: int = 4):
        """
        Initialize the positional player.
        
        Args:
            depth: Search depth for minimax algorithm (default 4)
        """
        self.depth = depth
        self.nodes_searched = 0
    
    def get_best_move(self, board: chess.Board) -> Optional[chess.Move]:
        """
        Get the best move for the current position using minimax with alpha-beta pruning.
        
        Args:
            board: Current chess board state
            
        Returns:
            The best move according to positional evaluation, or None if no legal moves
        """
        self.nodes_searched = 0
        
        if board.is_game_over():
            return None
        
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            return None
        
        best_move = None
        best_value = float('-inf') if board.turn == chess.WHITE else float('inf')
        alpha = float('-inf')
        beta = float('inf')
        
        # Order moves for better alpha-beta pruning
        ordered_moves = self._order_moves(board, legal_moves)
        
        for move in ordered_moves:
            board.push(move)
            
            if board.turn == chess.BLACK:  # We just made a White move
                value = self._minimax(board, self.depth - 1, alpha, beta, False)
                if value > best_value:
                    best_value = value
                    best_move = move
                alpha = max(alpha, value)
            else:  # We just made a Black move
                value = self._minimax(board, self.depth - 1, alpha, beta, True)
                if value < best_value:
                    best_value = value
                    best_move = move
                beta = min(beta, value)
            
            board.pop()
        
        return best_move
    
    def _minimax(
        self,
        board: chess.Board,
        depth: int,
        alpha: float,
        beta: float,
        maximizing: bool
    ) -> float:
        """
        Minimax algorithm with alpha-beta pruning.
        
        Args:
            board: Current board state
            depth: Remaining search depth
            alpha: Alpha value for pruning
            beta: Beta value for pruning
            maximizing: True if maximizing player (White)
            
        Returns:
            Evaluation score of the position
        """
        self.nodes_searched += 1
        
        # Terminal conditions
        if depth == 0 or board.is_game_over():
            return self._evaluate_position(board)
        
        legal_moves = list(board.legal_moves)
        ordered_moves = self._order_moves(board, legal_moves)
        
        if maximizing:
            max_eval = float('-inf')
            for move in ordered_moves:
                board.push(move)
                eval_score = self._minimax(board, depth - 1, alpha, beta, False)
                board.pop()
                max_eval = max(max_eval, eval_score)
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break  # Beta cutoff
            return max_eval
        else:
            min_eval = float('inf')
            for move in ordered_moves:
                board.push(move)
                eval_score = self._minimax(board, depth - 1, alpha, beta, True)
                board.pop()
                min_eval = min(min_eval, eval_score)
                beta = min(beta, eval_score)
                if beta <= alpha:
                    break  # Alpha cutoff
            return min_eval
    
    def _order_moves(self, board: chess.Board, moves: List[chess.Move]) -> List[chess.Move]:
        """
        Order moves for better alpha-beta pruning efficiency.
        
        Prioritizes:
        1. Captures (especially high-value captures with low-value pieces)
        2. Checks
        3. Castling (for safety)
        4. Central moves
        5. Other moves
        
        Args:
            board: Current board state
            moves: List of legal moves
            
        Returns:
            Ordered list of moves
        """
        def move_score(move: chess.Move) -> int:
            score = 0
            
            # Prioritize captures using MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
            if board.is_capture(move):
                victim = board.piece_at(move.to_square)
                attacker = board.piece_at(move.from_square)
                if victim and attacker:
                    score += 10000 + PIECE_VALUES.get(victim.piece_type, 0) - PIECE_VALUES.get(attacker.piece_type, 0) // 10
            
            # Prioritize checks (defensive players like safe checks)
            board.push(move)
            if board.is_check():
                score += 5000
            board.pop()
            
            # Prioritize castling for king safety
            if board.is_castling(move):
                score += 4000
            
            # Prioritize moves to central squares
            if move.to_square in CENTER_SQUARES:
                score += 100
            elif move.to_square in EXTENDED_CENTER:
                score += 50
            
            # Prioritize promotions
            if move.promotion:
                score += 8000 + PIECE_VALUES.get(move.promotion, 0)
            
            return score
        
        return sorted(moves, key=move_score, reverse=True)
    
    def _evaluate_position(self, board: chess.Board) -> float:
        """
        Evaluate a chess position from White's perspective.
        
        A positional/defensive evaluation considers:
        1. Material balance
        2. Piece-square positioning
        3. Mobility (piece activity)
        4. Pawn structure quality
        5. King safety
        6. Development status
        7. Center control
        
        Args:
            board: Board position to evaluate
            
        Returns:
            Evaluation score (positive = White advantage)
        """
        # Check for game-ending conditions
        if board.is_checkmate():
            return float('-inf') if board.turn == chess.WHITE else float('inf')
        if board.is_stalemate() or board.is_insufficient_material():
            return 0
        if board.can_claim_draw():
            return 0
        
        evaluation = PositionalEvaluation()
        
        # 1. Material evaluation
        evaluation.material = self._evaluate_material(board)
        
        # 2. Piece-square table evaluation
        evaluation.piece_position = self._evaluate_piece_positions(board)
        
        # 3. Mobility evaluation
        evaluation.mobility = self._evaluate_mobility(board)
        
        # 4. Pawn structure evaluation
        evaluation.pawn_structure = self._evaluate_pawn_structure(board)
        
        # 5. King safety evaluation (CRITICAL for defensive play)
        evaluation.king_safety = self._evaluate_king_safety(board)
        
        # 6. Development evaluation
        evaluation.development = self._evaluate_development(board)
        
        # 7. Center control evaluation
        evaluation.center_control = self._evaluate_center_control(board)
        
        return evaluation.total
    
    def _evaluate_material(self, board: chess.Board) -> int:
        """Evaluate material balance."""
        score = 0
        for piece_type in PIECE_VALUES:
            white_pieces = len(board.pieces(piece_type, chess.WHITE))
            black_pieces = len(board.pieces(piece_type, chess.BLACK))
            score += PIECE_VALUES[piece_type] * (white_pieces - black_pieces)
        return score
    
    def _evaluate_piece_positions(self, board: chess.Board) -> int:
        """Evaluate piece positions using piece-square tables."""
        score = 0
        is_endgame = self._is_endgame(board)
        
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece is None:
                continue
            
            # Get the appropriate table
            if piece.piece_type == chess.KING and is_endgame:
                table = KING_END_TABLE
            else:
                table = PIECE_SQUARE_TABLES.get(piece.piece_type)
            
            if table:
                if piece.color == chess.WHITE:
                    # White pieces use table directly (flip vertically)
                    table_square = chess.square_mirror(square)
                    score += table[table_square]
                else:
                    # Black pieces use table normally
                    score -= table[square]
        
        return score
    
    def _evaluate_mobility(self, board: chess.Board) -> int:
        """
        Evaluate piece mobility (number of legal moves).
        
        Defensive strategy: Value safe mobility, not just any mobility.
        """
        score = 0
        
        # Count White's mobility
        original_turn = board.turn
        board.turn = chess.WHITE
        white_moves = len(list(board.legal_moves))
        
        # Count Black's mobility
        board.turn = chess.BLACK
        black_moves = len(list(board.legal_moves))
        
        # Restore turn
        board.turn = original_turn
        
        # Each legal move is worth ~5 centipawns
        score = 5 * (white_moves - black_moves)
        
        return score
    
    def _evaluate_pawn_structure(self, board: chess.Board) -> int:
        """
        Evaluate pawn structure quality.
        
        Penalizes:
        - Doubled pawns (pawns on same file)
        - Isolated pawns (no friendly pawns on adjacent files)
        - Backward pawns (cannot advance safely)
        
        Rewards:
        - Connected pawns
        - Passed pawns
        """
        score = 0
        
        for color in [chess.WHITE, chess.BLACK]:
            multiplier = 1 if color == chess.WHITE else -1
            pawns = board.pieces(chess.PAWN, color)
            pawn_files = [chess.square_file(sq) for sq in pawns]
            
            for square in pawns:
                file = chess.square_file(square)
                rank = chess.square_rank(square)
                
                # Doubled pawns penalty (-20 centipawns)
                if pawn_files.count(file) > 1:
                    score -= 20 * multiplier
                
                # Isolated pawns penalty (-25 centipawns)
                adjacent_files = [f for f in [file - 1, file + 1] if 0 <= f <= 7]
                has_neighbor = any(f in pawn_files for f in adjacent_files)
                if not has_neighbor:
                    score -= 25 * multiplier
                
                # Passed pawn bonus (no enemy pawns blocking or attacking)
                is_passed = self._is_passed_pawn(board, square, color)
                if is_passed:
                    # Passed pawn value increases as it advances
                    advancement = rank if color == chess.WHITE else (7 - rank)
                    score += (20 + advancement * 10) * multiplier
                
                # Connected pawns bonus
                if self._is_connected_pawn(board, square, color):
                    score += 10 * multiplier
        
        return score
    
    def _is_passed_pawn(self, board: chess.Board, square: int, color: chess.Color) -> bool:
        """Check if a pawn is passed (no enemy pawns can block or capture it)."""
        file = chess.square_file(square)
        rank = chess.square_rank(square)
        
        enemy_color = not color
        direction = 1 if color == chess.WHITE else -1
        
        # Check all squares ahead on the same and adjacent files
        for check_file in [file - 1, file, file + 1]:
            if not 0 <= check_file <= 7:
                continue
            
            start_rank = rank + direction
            end_rank = 8 if color == chess.WHITE else -1
            
            for check_rank in range(start_rank, end_rank, direction):
                check_square = chess.square(check_file, check_rank)
                piece = board.piece_at(check_square)
                if piece and piece.piece_type == chess.PAWN and piece.color == enemy_color:
                    return False
        
        return True
    
    def _is_connected_pawn(self, board: chess.Board, square: int, color: chess.Color) -> bool:
        """Check if a pawn is connected to another friendly pawn."""
        file = chess.square_file(square)
        rank = chess.square_rank(square)
        
        # Check adjacent files at same or one rank behind
        for adj_file in [file - 1, file + 1]:
            if not 0 <= adj_file <= 7:
                continue
            
            for adj_rank in [rank - 1, rank, rank + 1]:
                if not 0 <= adj_rank <= 7 or (adj_file == file and adj_rank == rank):
                    continue
                
                adj_square = chess.square(adj_file, adj_rank)
                piece = board.piece_at(adj_square)
                if piece and piece.piece_type == chess.PAWN and piece.color == color:
                    return True
        
        return False
    
    def _evaluate_king_safety(self, board: chess.Board) -> int:
        """
        Evaluate king safety - CRITICAL for defensive play.
        
        Considers:
        - Castling status (bonus for castled king)
        - Pawn shield in front of king
        - Open files near king
        - Attacking pieces near king
        """
        score = 0
        
        for color in [chess.WHITE, chess.BLACK]:
            multiplier = 1 if color == chess.WHITE else -1
            king_square = board.king(color)
            
            if king_square is None:
                continue
            
            king_file = chess.square_file(king_square)
            king_rank = chess.square_rank(king_square)
            
            # Bonus for castled king position
            if color == chess.WHITE:
                if king_file in [6, 7] or king_file in [1, 2]:  # Kingside or queenside castled
                    score += 50 * multiplier
            else:
                if king_file in [6, 7] or king_file in [1, 2]:
                    score += 50 * multiplier
            
            # Pawn shield evaluation
            pawn_shield_bonus = self._evaluate_pawn_shield(board, king_square, color)
            score += pawn_shield_bonus * multiplier
            
            # Penalty for open files near king
            for file_offset in [-1, 0, 1]:
                check_file = king_file + file_offset
                if 0 <= check_file <= 7:
                    if self._is_open_file(board, check_file):
                        score -= 30 * multiplier
                    elif self._is_semi_open_file(board, check_file, color):
                        score -= 15 * multiplier
            
            # Penalty for enemy pieces attacking squares near king
            attack_penalty = self._evaluate_king_attackers(board, king_square, color)
            score -= attack_penalty * multiplier
        
        return score
    
    def _evaluate_pawn_shield(self, board: chess.Board, king_square: int, color: chess.Color) -> int:
        """Evaluate the pawn shield in front of the king."""
        score = 0
        king_file = chess.square_file(king_square)
        king_rank = chess.square_rank(king_square)
        
        # Direction of pawns relative to king
        pawn_direction = 1 if color == chess.WHITE else -1
        
        # Check pawns on the 2nd and 3rd ranks in front of king
        for file_offset in [-1, 0, 1]:
            check_file = king_file + file_offset
            if not 0 <= check_file <= 7:
                continue
            
            for rank_offset in [1, 2]:
                check_rank = king_rank + (pawn_direction * rank_offset)
                if not 0 <= check_rank <= 7:
                    continue
                
                check_square = chess.square(check_file, check_rank)
                piece = board.piece_at(check_square)
                
                if piece and piece.piece_type == chess.PAWN and piece.color == color:
                    # Closer pawns are more valuable
                    score += 15 if rank_offset == 1 else 10
        
        return score
    
    def _is_open_file(self, board: chess.Board, file: int) -> bool:
        """Check if a file has no pawns."""
        for rank in range(8):
            piece = board.piece_at(chess.square(file, rank))
            if piece and piece.piece_type == chess.PAWN:
                return False
        return True
    
    def _is_semi_open_file(self, board: chess.Board, file: int, color: chess.Color) -> bool:
        """Check if a file has no pawns of the specified color."""
        for rank in range(8):
            piece = board.piece_at(chess.square(file, rank))
            if piece and piece.piece_type == chess.PAWN and piece.color == color:
                return False
        return True
    
    def _evaluate_king_attackers(self, board: chess.Board, king_square: int, color: chess.Color) -> int:
        """Evaluate penalty for enemy pieces attacking squares near king."""
        penalty = 0
        enemy_color = not color
        
        # Get squares around the king
        king_file = chess.square_file(king_square)
        king_rank = chess.square_rank(king_square)
        
        for file_offset in [-1, 0, 1]:
            for rank_offset in [-1, 0, 1]:
                check_file = king_file + file_offset
                check_rank = king_rank + rank_offset
                
                if not (0 <= check_file <= 7 and 0 <= check_rank <= 7):
                    continue
                
                check_square = chess.square(check_file, check_rank)
                
                # Count enemy pieces attacking this square
                attackers = board.attackers(enemy_color, check_square)
                for attacker_square in attackers:
                    attacker = board.piece_at(attacker_square)
                    if attacker:
                        # Weight by piece type
                        if attacker.piece_type == chess.QUEEN:
                            penalty += 20
                        elif attacker.piece_type == chess.ROOK:
                            penalty += 15
                        elif attacker.piece_type == chess.BISHOP:
                            penalty += 10
                        elif attacker.piece_type == chess.KNIGHT:
                            penalty += 10
        
        return penalty
    
    def _evaluate_development(self, board: chess.Board) -> int:
        """
        Evaluate piece development status.
        
        Rewards:
        - Knights and bishops developed from starting squares
        - Castling completed
        - Rooks connected
        """
        score = 0
        
        # Development bonus for minor pieces not on starting squares
        white_knight_starts = [chess.B1, chess.G1]
        white_bishop_starts = [chess.C1, chess.F1]
        black_knight_starts = [chess.B8, chess.G8]
        black_bishop_starts = [chess.C8, chess.F8]
        
        # White development
        for square in board.pieces(chess.KNIGHT, chess.WHITE):
            if square not in white_knight_starts:
                score += 20
        
        for square in board.pieces(chess.BISHOP, chess.WHITE):
            if square not in white_bishop_starts:
                score += 20
        
        # Black development
        for square in board.pieces(chess.KNIGHT, chess.BLACK):
            if square not in black_knight_starts:
                score -= 20
        
        for square in board.pieces(chess.BISHOP, chess.BLACK):
            if square not in black_bishop_starts:
                score -= 20
        
        # Castling rights bonus (encourages preserving the option)
        if board.has_kingside_castling_rights(chess.WHITE):
            score += 10
        if board.has_queenside_castling_rights(chess.WHITE):
            score += 5
        if board.has_kingside_castling_rights(chess.BLACK):
            score -= 10
        if board.has_queenside_castling_rights(chess.BLACK):
            score -= 5
        
        return score
    
    def _evaluate_center_control(self, board: chess.Board) -> int:
        """
        Evaluate control of the center squares.
        
        Positional play emphasizes controlling the center with pieces and pawns.
        """
        score = 0
        
        # Points for controlling center squares
        for square in CENTER_SQUARES:
            white_attackers = len(board.attackers(chess.WHITE, square))
            black_attackers = len(board.attackers(chess.BLACK, square))
            score += 10 * (white_attackers - black_attackers)
            
            # Bonus for occupation
            piece = board.piece_at(square)
            if piece:
                if piece.color == chess.WHITE:
                    score += 15
                else:
                    score -= 15
        
        # Smaller bonus for extended center
        for square in EXTENDED_CENTER:
            if square not in CENTER_SQUARES:
                white_attackers = len(board.attackers(chess.WHITE, square))
                black_attackers = len(board.attackers(chess.BLACK, square))
                score += 3 * (white_attackers - black_attackers)
        
        return score
    
    def _is_endgame(self, board: chess.Board) -> bool:
        """
        Determine if the position is an endgame.
        
        Heuristic: Endgame if queens are off or each side has <= 13 points in minor/major pieces.
        """
        white_queen = len(board.pieces(chess.QUEEN, chess.WHITE))
        black_queen = len(board.pieces(chess.QUEEN, chess.BLACK))
        
        if white_queen == 0 and black_queen == 0:
            return True
        
        # Calculate non-pawn, non-king material
        white_material = (
            len(board.pieces(chess.KNIGHT, chess.WHITE)) * 3 +
            len(board.pieces(chess.BISHOP, chess.WHITE)) * 3 +
            len(board.pieces(chess.ROOK, chess.WHITE)) * 5 +
            len(board.pieces(chess.QUEEN, chess.WHITE)) * 9
        )
        
        black_material = (
            len(board.pieces(chess.KNIGHT, chess.BLACK)) * 3 +
            len(board.pieces(chess.BISHOP, chess.BLACK)) * 3 +
            len(board.pieces(chess.ROOK, chess.BLACK)) * 5 +
            len(board.pieces(chess.QUEEN, chess.BLACK)) * 9
        )
        
        return white_material <= 13 and black_material <= 13
    
    def get_detailed_evaluation(self, board: chess.Board) -> PositionalEvaluation:
        """
        Get a detailed breakdown of the position evaluation.
        
        Useful for debugging and understanding the engine's assessment.
        
        Args:
            board: Board position to evaluate
            
        Returns:
            PositionalEvaluation with all component scores
        """
        evaluation = PositionalEvaluation()
        evaluation.material = self._evaluate_material(board)
        evaluation.piece_position = self._evaluate_piece_positions(board)
        evaluation.mobility = self._evaluate_mobility(board)
        evaluation.pawn_structure = self._evaluate_pawn_structure(board)
        evaluation.king_safety = self._evaluate_king_safety(board)
        evaluation.development = self._evaluate_development(board)
        evaluation.center_control = self._evaluate_center_control(board)
        return evaluation


def get_move(board: chess.Board, depth: int = 4) -> Optional[chess.Move]:
    """
    Main function to get the next move given a board state.
    
    This is the primary entry point for using the positional player.
    
    Args:
        board: Current chess board state (python-chess Board object)
        depth: Search depth for minimax (default 4, range 3-4 recommended)
        
    Returns:
        The best move according to positional evaluation, or None if game is over
        
    Example:
        >>> import chess
        >>> board = chess.Board()
        >>> move = get_move(board)
        >>> print(move)  # e.g., e2e4
    """
    player = PositionalPlayer(depth=depth)
    return player.get_best_move(board)


def get_move_from_fen(fen: str, depth: int = 4) -> Optional[str]:
    """
    Get the next move given a FEN string.
    
    Convenience function for integration with other systems.
    
    Args:
        fen: FEN string representing the board position
        depth: Search depth for minimax (default 4)
        
    Returns:
        The best move in UCI notation (e.g., "e2e4"), or None if game is over
        
    Example:
        >>> move = get_move_from_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
        >>> print(move)  # e.g., "e2e4"
    """
    board = chess.Board(fen)
    move = get_move(board, depth)
    return move.uci() if move else None


# Main entry point for command-line usage
if __name__ == "__main__":
    import sys
    
    # Default to starting position
    fen = sys.argv[1] if len(sys.argv) > 1 else chess.STARTING_FEN
    depth = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    
    board = chess.Board(fen)
    
    print(f"Position: {fen}")
    print(f"Search depth: {depth}")
    print(f"Turn: {'White' if board.turn == chess.WHITE else 'Black'}")
    print()
    
    player = PositionalPlayer(depth=depth)
    
    # Get detailed evaluation
    evaluation = player.get_detailed_evaluation(board)
    print("Position Evaluation:")
    print(f"  Material:       {evaluation.material:+d} cp")
    print(f"  Piece Position: {evaluation.piece_position:+d} cp")
    print(f"  Mobility:       {evaluation.mobility:+d} cp")
    print(f"  Pawn Structure: {evaluation.pawn_structure:+d} cp")
    print(f"  King Safety:    {evaluation.king_safety:+d} cp")
    print(f"  Development:    {evaluation.development:+d} cp")
    print(f"  Center Control: {evaluation.center_control:+d} cp")
    print(f"  --------------------------")
    print(f"  Total:          {evaluation.total:+d} cp")
    print()
    
    # Get best move
    best_move = player.get_best_move(board)
    
    if best_move:
        print(f"Best move: {best_move.uci()}")
        print(f"Nodes searched: {player.nodes_searched}")
    else:
        print("No legal moves available (game over)")
