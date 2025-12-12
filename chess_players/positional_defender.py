"""
PositionalDefender - A defensive/positional chess player implementation.

This player prioritizes:
1. Solid pawn structure - avoiding isolated, doubled, or backward pawns
2. King safety - castling early and maintaining a safe king position
3. Piece coordination - keeping pieces well-connected and supporting each other
4. Prophylaxis - preventing opponent's plans before they develop
5. Endgame preparation - simplifying when ahead, keeping position solid

The evaluation heavily weights defensive factors and piece placement that
supports a solid, hard-to-break position.
"""

import chess
from typing import Optional, List, Tuple

# =============================================================================
# PIECE-SQUARE TABLES (from White's perspective, flip for Black)
# These tables favor solid, defensive piece placement
# =============================================================================

# Pawns: Favor central pawns and avoid advancing wing pawns (keep structure solid)
PAWN_TABLE = [
    0,   0,   0,   0,   0,   0,   0,   0,
    50,  50,  50,  50,  50,  50,  50,  50,
    10,  10,  20,  30,  30,  20,  10,  10,
    5,   5,   10,  25,  25,  10,  5,   5,
    0,   0,   0,   20,  20,  0,   0,   0,
    5,  -5,  -10,  0,   0,  -10, -5,   5,
    5,   10,  10, -20, -20,  10,  10,  5,
    0,   0,   0,   0,   0,   0,   0,   0
]

# Knights: Favor central outposts and avoid edges (defensive stability)
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

# Bishops: Favor diagonals that support the center and king
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

# Rooks: Favor back rank (defensive) and open files
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

# Queen: Keep queen safe and well-positioned (avoid early queen moves)
QUEEN_TABLE = [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
    -5,    0,   5,   5,   5,   5,   0,  -5,
    0,     0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20
]

# King Middle Game: Favor castled position, penalize center exposure
KING_MIDDLEGAME_TABLE = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20,   20,   0,   0,   0,   0,  20,  20,
    20,   30,  10,   0,   0,  10,  30,  20
]

# King Endgame: More active king is needed
KING_ENDGAME_TABLE = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10,   0,   0, -10, -20, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -30,   0,   0,   0,   0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50
]

# Piece values (centipawns)
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000
}


class PositionalDefender:
    """
    A defensive/positional chess player that prioritizes solid structure,
    king safety, and piece coordination over aggressive tactics.
    
    Philosophy:
    - "Defense first, attack second"
    - "A bad plan is better than no plan, but a solid position is best"
    - "When in doubt, improve your worst piece"
    - "Trade pieces when ahead, keep pawns when defending"
    """
    
    def __init__(self, search_depth: int = 3):
        """
        Initialize the PositionalDefender.
        
        Args:
            search_depth: How many moves ahead to search (default 3 for balance
                         between strength and speed)
        """
        self.search_depth = search_depth
        self.transposition_table: dict = {}
    
    def get_best_move(self, board: chess.Board) -> Optional[chess.Move]:
        """
        Get the best move for the current position using defensive/positional evaluation.
        
        Args:
            board: The current chess board state
            
        Returns:
            The best move according to positional/defensive criteria, or None if no legal moves
        """
        if board.is_game_over():
            return None
        
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            return None
        
        # Use iterative deepening for better move ordering
        best_move = legal_moves[0]
        best_score = float('-inf') if board.turn == chess.WHITE else float('inf')
        
        # Sort moves by defensive priority (prophylaxis)
        sorted_moves = self._order_moves(board, legal_moves)
        
        for move in sorted_moves:
            board.push(move)
            score = self._minimax(
                board, 
                self.search_depth - 1, 
                float('-inf'), 
                float('inf'),
                not board.turn
            )
            board.pop()
            
            if board.turn == chess.WHITE:
                if score > best_score:
                    best_score = score
                    best_move = move
            else:
                if score < best_score:
                    best_score = score
                    best_move = move
        
        return best_move
    
    def _minimax(self, board: chess.Board, depth: int, alpha: float, beta: float, 
                 maximizing: bool) -> float:
        """
        Minimax search with alpha-beta pruning.
        
        Args:
            board: Current board state
            depth: Remaining search depth
            alpha: Alpha value for pruning
            beta: Beta value for pruning
            maximizing: True if maximizing player's turn
            
        Returns:
            The evaluation score for this position
        """
        # Check transposition table
        board_hash = board.fen()
        if board_hash in self.transposition_table:
            cached_depth, cached_score = self.transposition_table[board_hash]
            if cached_depth >= depth:
                return cached_score
        
        # Terminal conditions
        if depth == 0 or board.is_game_over():
            score = self.evaluate_position(board)
            self.transposition_table[board_hash] = (depth, score)
            return score
        
        legal_moves = self._order_moves(board, list(board.legal_moves))
        
        if maximizing:
            max_eval = float('-inf')
            for move in legal_moves:
                board.push(move)
                eval_score = self._minimax(board, depth - 1, alpha, beta, False)
                board.pop()
                max_eval = max(max_eval, eval_score)
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break  # Beta cutoff
            self.transposition_table[board_hash] = (depth, max_eval)
            return max_eval
        else:
            min_eval = float('inf')
            for move in legal_moves:
                board.push(move)
                eval_score = self._minimax(board, depth - 1, alpha, beta, True)
                board.pop()
                min_eval = min(min_eval, eval_score)
                beta = min(beta, eval_score)
                if beta <= alpha:
                    break  # Alpha cutoff
            self.transposition_table[board_hash] = (depth, min_eval)
            return min_eval
    
    def _order_moves(self, board: chess.Board, moves: List[chess.Move]) -> List[chess.Move]:
        """
        Order moves to improve alpha-beta pruning efficiency.
        Prioritizes defensive moves and checks.
        
        Args:
            board: Current board state
            moves: List of legal moves to order
            
        Returns:
            Sorted list of moves (best first)
        """
        def move_priority(move: chess.Move) -> int:
            priority = 0
            
            # Captures with good exchange (MVV-LVA: Most Valuable Victim - Least Valuable Attacker)
            if board.is_capture(move):
                victim = board.piece_at(move.to_square)
                attacker = board.piece_at(move.from_square)
                if victim and attacker:
                    priority += 10 * PIECE_VALUES.get(victim.piece_type, 0) - PIECE_VALUES.get(attacker.piece_type, 0)
            
            # Checks are important (prophylaxis and attack)
            board.push(move)
            if board.is_check():
                priority += 500
            board.pop()
            
            # Castling is great for king safety
            if board.is_castling(move):
                priority += 800
            
            # Moves that improve piece coordination (toward center)
            to_file = chess.square_file(move.to_square)
            to_rank = chess.square_rank(move.to_square)
            center_bonus = (3.5 - abs(to_file - 3.5)) + (3.5 - abs(to_rank - 3.5))
            priority += int(center_bonus * 10)
            
            # Penalize moving pieces away from king (defensive coordination)
            our_king = board.king(board.turn)
            if our_king:
                from_dist = chess.square_distance(move.from_square, our_king)
                to_dist = chess.square_distance(move.to_square, our_king)
                if to_dist > from_dist + 2:  # Moving far from king
                    priority -= 50
            
            return priority
        
        return sorted(moves, key=move_priority, reverse=True)
    
    def evaluate_position(self, board: chess.Board) -> float:
        """
        Evaluate the current position with emphasis on defensive/positional factors.
        
        Positive scores favor White, negative scores favor Black.
        
        Args:
            board: The board position to evaluate
            
        Returns:
            Evaluation score in centipawns
        """
        if board.is_checkmate():
            return -20000 if board.turn == chess.WHITE else 20000
        
        if board.is_stalemate() or board.is_insufficient_material():
            return 0
        
        score = 0.0
        
        # 1. Material evaluation
        score += self._evaluate_material(board)
        
        # 2. Piece-square table evaluation
        score += self._evaluate_piece_squares(board)
        
        # 3. King safety (HEAVILY WEIGHTED for defensive play)
        score += self._evaluate_king_safety(board) * 2.0
        
        # 4. Pawn structure (HEAVILY WEIGHTED for positional play)
        score += self._evaluate_pawn_structure(board) * 1.5
        
        # 5. Piece coordination
        score += self._evaluate_piece_coordination(board)
        
        # 6. Control of key squares
        score += self._evaluate_square_control(board)
        
        # 7. Prophylaxis bonus (penalize opponent threats)
        score += self._evaluate_prophylaxis(board)
        
        return score
    
    def _evaluate_material(self, board: chess.Board) -> float:
        """Evaluate material balance."""
        score = 0.0
        for piece_type in PIECE_VALUES:
            white_pieces = len(board.pieces(piece_type, chess.WHITE))
            black_pieces = len(board.pieces(piece_type, chess.BLACK))
            score += (white_pieces - black_pieces) * PIECE_VALUES[piece_type]
        return score
    
    def _evaluate_piece_squares(self, board: chess.Board) -> float:
        """Evaluate piece placement using piece-square tables."""
        score = 0.0
        is_endgame = self._is_endgame(board)
        
        piece_tables = {
            chess.PAWN: PAWN_TABLE,
            chess.KNIGHT: KNIGHT_TABLE,
            chess.BISHOP: BISHOP_TABLE,
            chess.ROOK: ROOK_TABLE,
            chess.QUEEN: QUEEN_TABLE,
        }
        
        for piece_type, table in piece_tables.items():
            # White pieces
            for square in board.pieces(piece_type, chess.WHITE):
                score += table[63 - square]  # Flip for white perspective
            
            # Black pieces
            for square in board.pieces(piece_type, chess.BLACK):
                score -= table[square]  # Black perspective
        
        # King evaluation depends on game phase
        king_table = KING_ENDGAME_TABLE if is_endgame else KING_MIDDLEGAME_TABLE
        
        white_king = board.king(chess.WHITE)
        if white_king is not None:
            score += king_table[63 - white_king]
        
        black_king = board.king(chess.BLACK)
        if black_king is not None:
            score -= king_table[black_king]
        
        return score
    
    def _evaluate_king_safety(self, board: chess.Board) -> float:
        """
        Evaluate king safety - critical for defensive play.
        
        Considers:
        - Pawn shield around the king
        - Open files near the king
        - Enemy pieces attacking near king
        - Castling rights
        """
        score = 0.0
        
        for color in [chess.WHITE, chess.BLACK]:
            king_square = board.king(color)
            if king_square is None:
                continue
            
            sign = 1 if color == chess.WHITE else -1
            king_file = chess.square_file(king_square)
            king_rank = chess.square_rank(king_square)
            
            # Pawn shield bonus
            pawn_shield_bonus = 0
            shield_squares = self._get_pawn_shield_squares(king_square, color)
            for sq in shield_squares:
                piece = board.piece_at(sq)
                if piece and piece.piece_type == chess.PAWN and piece.color == color:
                    pawn_shield_bonus += 25
            score += sign * pawn_shield_bonus
            
            # Penalize open files near king
            for f in range(max(0, king_file - 1), min(8, king_file + 2)):
                if self._is_open_file(board, f):
                    score -= sign * 30
                elif self._is_semi_open_file(board, f, color):
                    score -= sign * 15
            
            # Bonus for castling rights (if not yet castled)
            if color == chess.WHITE:
                if board.has_kingside_castling_rights(chess.WHITE):
                    score += 20
                if board.has_queenside_castling_rights(chess.WHITE):
                    score += 15
            else:
                if board.has_kingside_castling_rights(chess.BLACK):
                    score -= 20
                if board.has_queenside_castling_rights(chess.BLACK):
                    score -= 15
            
            # Penalize king in center during middlegame
            if not self._is_endgame(board):
                if 2 <= king_file <= 5 and (
                    (color == chess.WHITE and king_rank == 0) or 
                    (color == chess.BLACK and king_rank == 7)
                ):
                    score -= sign * 40  # King still in center, hasn't castled
        
        return score
    
    def _get_pawn_shield_squares(self, king_square: int, color: chess.Color) -> List[int]:
        """Get the squares that should contain a pawn shield for the king."""
        squares = []
        king_file = chess.square_file(king_square)
        king_rank = chess.square_rank(king_square)
        
        # Direction of pawn shield depends on color
        shield_rank = king_rank + (1 if color == chess.WHITE else -1)
        
        if 0 <= shield_rank <= 7:
            for f in range(max(0, king_file - 1), min(8, king_file + 2)):
                squares.append(chess.square(f, shield_rank))
        
        return squares
    
    def _evaluate_pawn_structure(self, board: chess.Board) -> float:
        """
        Evaluate pawn structure - essential for positional play.
        
        Penalizes:
        - Isolated pawns (no friendly pawns on adjacent files)
        - Doubled pawns (multiple pawns on same file)
        - Backward pawns (cannot be protected by other pawns)
        
        Rewards:
        - Passed pawns
        - Connected pawns
        - Pawn chains
        """
        score = 0.0
        
        for color in [chess.WHITE, chess.BLACK]:
            sign = 1 if color == chess.WHITE else -1
            pawns = list(board.pieces(chess.PAWN, color))
            
            # Track pawns by file
            pawns_by_file = [0] * 8
            for pawn_sq in pawns:
                pawns_by_file[chess.square_file(pawn_sq)] += 1
            
            for pawn_sq in pawns:
                pawn_file = chess.square_file(pawn_sq)
                pawn_rank = chess.square_rank(pawn_sq)
                
                # Check for isolated pawn
                is_isolated = True
                for adj_file in [pawn_file - 1, pawn_file + 1]:
                    if 0 <= adj_file <= 7 and pawns_by_file[adj_file] > 0:
                        is_isolated = False
                        break
                if is_isolated:
                    score -= sign * 20  # Isolated pawn penalty
                
                # Check for doubled pawn
                if pawns_by_file[pawn_file] > 1:
                    score -= sign * 15  # Doubled pawn penalty
                
                # Check for passed pawn
                is_passed = self._is_passed_pawn(board, pawn_sq, color)
                if is_passed:
                    # Passed pawn bonus increases with advancement
                    advancement = pawn_rank if color == chess.WHITE else (7 - pawn_rank)
                    score += sign * (20 + advancement * 10)
                
                # Connected pawns bonus
                for adj_file in [pawn_file - 1, pawn_file + 1]:
                    if 0 <= adj_file <= 7:
                        adj_rank = pawn_rank + (1 if color == chess.WHITE else -1)
                        if 0 <= adj_rank <= 7:
                            adj_sq = chess.square(adj_file, adj_rank)
                            adj_piece = board.piece_at(adj_sq)
                            if adj_piece and adj_piece.piece_type == chess.PAWN and adj_piece.color == color:
                                score += sign * 10  # Connected pawns bonus
        
        return score
    
    def _is_passed_pawn(self, board: chess.Board, pawn_square: int, color: chess.Color) -> bool:
        """Check if a pawn is passed (no enemy pawns can block or capture it)."""
        pawn_file = chess.square_file(pawn_square)
        pawn_rank = chess.square_rank(pawn_square)
        enemy_color = not color
        
        # Check files that could block or capture
        for f in range(max(0, pawn_file - 1), min(8, pawn_file + 2)):
            # Check ranks ahead of the pawn
            if color == chess.WHITE:
                ranks_to_check = range(pawn_rank + 1, 8)
            else:
                ranks_to_check = range(0, pawn_rank)
            
            for r in ranks_to_check:
                sq = chess.square(f, r)
                piece = board.piece_at(sq)
                if piece and piece.piece_type == chess.PAWN and piece.color == enemy_color:
                    return False
        
        return True
    
    def _evaluate_piece_coordination(self, board: chess.Board) -> float:
        """
        Evaluate how well pieces work together.
        
        Rewards:
        - Pieces defending each other
        - Rooks connected on ranks/files
        - Bishops on good diagonals
        - Knights on outpost squares
        """
        score = 0.0
        
        for color in [chess.WHITE, chess.BLACK]:
            sign = 1 if color == chess.WHITE else -1
            
            # Rook connectivity
            rooks = list(board.pieces(chess.ROOK, color))
            if len(rooks) >= 2:
                r1, r2 = rooks[0], rooks[1]
                if chess.square_file(r1) == chess.square_file(r2):
                    score += sign * 20  # Rooks doubled on file
                elif chess.square_rank(r1) == chess.square_rank(r2):
                    score += sign * 15  # Rooks connected on rank
            
            # Bishop pair bonus
            bishops = list(board.pieces(chess.BISHOP, color))
            if len(bishops) >= 2:
                score += sign * 30  # Bishop pair bonus
            
            # Knight outpost bonus (knight on advanced square protected by pawn)
            knights = list(board.pieces(chess.KNIGHT, color))
            for knight_sq in knights:
                knight_rank = chess.square_rank(knight_sq)
                is_outpost = False
                
                # Check if it's on an advanced square
                if (color == chess.WHITE and knight_rank >= 4) or (color == chess.BLACK and knight_rank <= 3):
                    # Check if protected by a pawn
                    knight_file = chess.square_file(knight_sq)
                    pawn_rank = knight_rank + (-1 if color == chess.WHITE else 1)
                    
                    for pf in [knight_file - 1, knight_file + 1]:
                        if 0 <= pf <= 7 and 0 <= pawn_rank <= 7:
                            pawn_sq = chess.square(pf, pawn_rank)
                            piece = board.piece_at(pawn_sq)
                            if piece and piece.piece_type == chess.PAWN and piece.color == color:
                                is_outpost = True
                                break
                
                if is_outpost:
                    score += sign * 25  # Knight outpost bonus
        
        return score
    
    def _evaluate_square_control(self, board: chess.Board) -> float:
        """Evaluate control of important central squares."""
        score = 0.0
        
        # Central squares are most important
        central_squares = [chess.D4, chess.D5, chess.E4, chess.E5]
        extended_center = [chess.C3, chess.C4, chess.C5, chess.C6,
                          chess.D3, chess.D6, chess.E3, chess.E6,
                          chess.F3, chess.F4, chess.F5, chess.F6]
        
        for sq in central_squares:
            white_attackers = len(board.attackers(chess.WHITE, sq))
            black_attackers = len(board.attackers(chess.BLACK, sq))
            score += (white_attackers - black_attackers) * 5
        
        for sq in extended_center:
            white_attackers = len(board.attackers(chess.WHITE, sq))
            black_attackers = len(board.attackers(chess.BLACK, sq))
            score += (white_attackers - black_attackers) * 2
        
        return score
    
    def _evaluate_prophylaxis(self, board: chess.Board) -> float:
        """
        Evaluate prophylactic factors - preventing opponent's plans.
        
        Penalizes positions where opponent has:
        - Many checks available
        - Threats to our pieces
        - Active piece placement
        """
        score = 0.0
        
        # Count opponent's attacking moves
        board_copy = board.copy()
        
        # Switch perspective to see opponent threats
        if board.turn == chess.WHITE:
            # We're white, check black's threats
            board_copy.turn = chess.BLACK
            enemy_moves = list(board_copy.legal_moves)
            
            for move in enemy_moves:
                # Penalize enemy checks
                board_copy.push(move)
                if board_copy.is_check():
                    score -= 10
                board_copy.pop()
                
                # Penalize attacks on our pieces
                if board.is_capture(move):
                    victim = board.piece_at(move.to_square)
                    if victim:
                        score -= PIECE_VALUES.get(victim.piece_type, 0) // 20
        else:
            # We're black, check white's threats
            board_copy.turn = chess.WHITE
            enemy_moves = list(board_copy.legal_moves)
            
            for move in enemy_moves:
                board_copy.push(move)
                if board_copy.is_check():
                    score += 10
                board_copy.pop()
                
                if board.is_capture(move):
                    victim = board.piece_at(move.to_square)
                    if victim:
                        score += PIECE_VALUES.get(victim.piece_type, 0) // 20
        
        return score
    
    def _is_endgame(self, board: chess.Board) -> bool:
        """
        Determine if the position is an endgame.
        
        Uses simple heuristic: endgame if both sides have no queens,
        or if each side has queen + minor piece or less.
        """
        white_queens = len(board.pieces(chess.QUEEN, chess.WHITE))
        black_queens = len(board.pieces(chess.QUEEN, chess.BLACK))
        
        if white_queens == 0 and black_queens == 0:
            return True
        
        # Count minor pieces
        white_minors = (len(board.pieces(chess.KNIGHT, chess.WHITE)) + 
                       len(board.pieces(chess.BISHOP, chess.WHITE)))
        black_minors = (len(board.pieces(chess.KNIGHT, chess.BLACK)) + 
                       len(board.pieces(chess.BISHOP, chess.BLACK)))
        
        # Count rooks
        white_rooks = len(board.pieces(chess.ROOK, chess.WHITE))
        black_rooks = len(board.pieces(chess.ROOK, chess.BLACK))
        
        # Endgame if very few pieces remain
        total_pieces = white_minors + black_minors + white_rooks + black_rooks
        return total_pieces <= 4
    
    def _is_open_file(self, board: chess.Board, file: int) -> bool:
        """Check if a file has no pawns at all."""
        for rank in range(8):
            piece = board.piece_at(chess.square(file, rank))
            if piece and piece.piece_type == chess.PAWN:
                return False
        return True
    
    def _is_semi_open_file(self, board: chess.Board, file: int, color: chess.Color) -> bool:
        """Check if a file is semi-open (no friendly pawns)."""
        for rank in range(8):
            piece = board.piece_at(chess.square(file, rank))
            if piece and piece.piece_type == chess.PAWN and piece.color == color:
                return False
        return True
    
    def clear_transposition_table(self):
        """Clear the transposition table (useful between games)."""
        self.transposition_table.clear()


# =============================================================================
# Convenience function for external use
# =============================================================================

def get_best_move(board: chess.Board, depth: int = 3) -> Optional[chess.Move]:
    """
    Get the best move for a position using the PositionalDefender strategy.
    
    Args:
        board: The current chess board state
        depth: Search depth (default 3)
        
    Returns:
        The best move according to defensive/positional evaluation
    """
    defender = PositionalDefender(search_depth=depth)
    return defender.get_best_move(board)


# =============================================================================
# Example usage and testing
# =============================================================================

if __name__ == "__main__":
    # Demo: Create a board and find the best move
    board = chess.Board()
    
    defender = PositionalDefender(search_depth=3)
    
    print("PositionalDefender Chess Engine")
    print("=" * 40)
    print(f"Starting position:\n{board}\n")
    
    # Play a few moves to demonstrate
    for i in range(6):
        if board.is_game_over():
            break
        
        move = defender.get_best_move(board)
        if move:
            print(f"Move {i + 1}: {board.san(move)}")
            board.push(move)
            print(f"Position after move:\n{board}\n")
            
            # Evaluate the position
            eval_score = defender.evaluate_position(board)
            print(f"Evaluation: {eval_score / 100:.2f} (positive favors White)\n")
    
    print("Demonstration complete!")
