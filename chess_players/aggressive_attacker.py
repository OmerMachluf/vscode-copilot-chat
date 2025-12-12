"""
Aggressive Attacker Chess Player

This chess player implementation prioritizes aggressive play, focusing on:
- Quick piece development toward the center and kingside
- Attack-first mentality: checks, captures, and threats before defense
- Maximizing piece mobility and central square control
- Launching attacks against the enemy king
- Willingness to sacrifice material for attacking chances

Uses the python-chess library for board representation and move generation.
"""

import chess
from typing import Optional, List, Tuple


class AggressiveAttacker:
    """
    An aggressive chess player that prioritizes attacking play over solid defense.
    
    The evaluation and move selection heavily favor:
    - Piece activity and mobility
    - King safety attacks
    - Central control
    - Quick development
    - Tactical opportunities (checks, captures, threats)
    """

    # Piece values (centipawns) - slightly reduced to encourage sacrifices
    PIECE_VALUES = {
        chess.PAWN: 100,
        chess.KNIGHT: 300,
        chess.BISHOP: 320,
        chess.ROOK: 500,
        chess.QUEEN: 900,
        chess.KING: 0  # King value handled separately
    }

    # Aggressive piece-square tables favor forward, attacking positions
    # Values in centipawns, from White's perspective (flip for Black)
    
    # Pawns: Push forward aggressively, especially center and kingside
    PAWN_TABLE = [
        0,   0,   0,   0,   0,   0,   0,   0,
        50,  50,  50,  50,  50,  50,  50,  50,
        15,  20,  30,  40,  40,  30,  20,  15,
        10,  15,  25,  35,  35,  25,  15,  10,
        5,   10,  20,  30,  30,  20,  10,   5,
        5,   5,   10,  25,  25,  10,   5,   5,
        5,   5,   5,  -10, -10,  5,   5,   5,
        0,   0,   0,   0,   0,   0,   0,   0
    ]

    # Knights: Favor outpost squares and attacking positions
    KNIGHT_TABLE = [
        -50, -30, -20, -20, -20, -20, -30, -50,
        -30, -10,  10,  15,  15,  10, -10, -30,
        -20,  15,  25,  35,  35,  25,  15, -20,
        -20,  20,  35,  40,  40,  35,  20, -20,
        -20,  15,  30,  35,  35,  30,  15, -20,
        -20,  10,  25,  30,  30,  25,  10, -20,
        -30, -10,  10,  15,  15,  10, -10, -30,
        -50, -30, -20, -20, -20, -20, -30, -50
    ]

    # Bishops: Favor long diagonals and attacking squares
    BISHOP_TABLE = [
        -20, -15, -10, -10, -10, -10, -15, -20,
        -15,   5,  10,  15,  15,  10,   5, -15,
        -10,  15,  20,  25,  25,  20,  15, -10,
        -10,  10,  25,  30,  30,  25,  10, -10,
        -10,  15,  25,  30,  30,  25,  15, -10,
        -10,  20,  20,  25,  25,  20,  20, -10,
        -15,  15,  10,  10,  10,  10,  15, -15,
        -20, -15, -40, -10, -10, -40, -15, -20
    ]

    # Rooks: Favor open files and 7th rank (attacking rank)
    ROOK_TABLE = [
        10,  15,  15,  20,  20,  15,  15,  10,
        25,  30,  30,  35,  35,  30,  30,  25,
        5,   10,  15,  20,  20,  15,  10,   5,
        0,   5,   10,  15,  15,  10,   5,   0,
        0,   5,   10,  15,  15,  10,   5,   0,
        0,   5,   10,  15,  15,  10,   5,   0,
        0,   5,   10,  15,  15,  10,   5,   0,
        0,   0,   5,   10,  10,   5,   0,   0
    ]

    # Queen: Favor central and attacking squares, but not too early development
    QUEEN_TABLE = [
        -20, -10, -10,  0,   0, -10, -10, -20,
        -10,   5,  10,  10,  10,  10,   5, -10,
        -10,  10,  15,  20,  20,  15,  10, -10,
        -5,   10,  15,  20,  20,  15,  10,  -5,
        -5,   10,  15,  20,  20,  15,  10,  -5,
        -10,  10,  15,  15,  15,  15,  10, -10,
        -10,   5,   5,   5,   5,   5,   5, -10,
        -20, -10, -10, -5,  -5, -10, -10, -20
    ]

    # King: In middlegame, stay castled; in endgame, become active
    # This is middlegame table - king should stay safe while pieces attack
    KING_MIDDLEGAME_TABLE = [
        -40, -40, -50, -60, -60, -50, -40, -40,
        -40, -40, -50, -60, -60, -50, -40, -40,
        -40, -40, -50, -60, -60, -50, -40, -40,
        -40, -40, -50, -60, -60, -50, -40, -40,
        -30, -30, -40, -50, -50, -40, -30, -30,
        -20, -20, -30, -40, -40, -30, -20, -20,
        -10, -10, -20, -30, -30, -20, -10, -10,
        10,  20,   0, -20, -20,   0,  20,  10
    ]

    # King endgame: Become active and centralized
    KING_ENDGAME_TABLE = [
        -20, -10,   0,  10,  10,   0, -10, -20,
        -10,   5,  15,  20,  20,  15,   5, -10,
        0,   15,  25,  30,  30,  25,  15,   0,
        10,  20,  30,  40,  40,  30,  20,  10,
        10,  20,  30,  40,  40,  30,  20,  10,
        0,   15,  25,  30,  30,  25,  15,   0,
        -10,   5,  15,  20,  20,  15,   5, -10,
        -20, -10,   0,  10,  10,   0, -10, -20
    ]

    def __init__(self, aggression_factor: float = 1.5):
        """
        Initialize the Aggressive Attacker.
        
        Args:
            aggression_factor: Multiplier for attack-related bonuses (default 1.5)
                              Higher values = more aggressive play
        """
        self.aggression_factor = aggression_factor
        self.move_history: List[chess.Move] = []

    def get_best_move(self, board: chess.Board) -> Optional[chess.Move]:
        """
        Select the best move for the current position using aggressive evaluation.
        
        The move selection prioritizes:
        1. Checkmate opportunities
        2. Checks that lead to advantage
        3. Captures that improve position
        4. Attacking moves and threats
        5. Development and piece activity
        
        Args:
            board: Current chess board state
            
        Returns:
            The best move according to aggressive evaluation, or None if no legal moves
        """
        legal_moves = list(board.legal_moves)
        
        if not legal_moves:
            return None
        
        # Use iterative deepening with a fixed depth for now
        best_move = None
        best_score = float('-inf')
        
        # Sort moves to improve alpha-beta pruning efficiency
        # Prioritize: checks, captures, attacks
        sorted_moves = self._order_moves(board, legal_moves)
        
        for move in sorted_moves:
            board.push(move)
            # Negative because we're evaluating from opponent's perspective after our move
            score = -self._alpha_beta(board, depth=3, alpha=float('-inf'), 
                                       beta=float('inf'), maximizing=False)
            board.pop()
            
            if score > best_score:
                best_score = score
                best_move = move
        
        if best_move:
            self.move_history.append(best_move)
        
        return best_move

    def _alpha_beta(self, board: chess.Board, depth: int, alpha: float, 
                    beta: float, maximizing: bool) -> float:
        """
        Alpha-beta search with aggressive evaluation.
        
        Args:
            board: Current board state
            depth: Remaining search depth
            alpha: Alpha value for pruning
            beta: Beta value for pruning
            maximizing: True if maximizing player's turn
            
        Returns:
            Evaluation score for the position
        """
        # Terminal conditions
        if board.is_checkmate():
            return float('-inf') if maximizing else float('inf')
        
        if board.is_stalemate() or board.is_insufficient_material():
            return 0
        
        if depth == 0:
            return self._evaluate_position(board)
        
        legal_moves = list(board.legal_moves)
        sorted_moves = self._order_moves(board, legal_moves)
        
        if maximizing:
            max_eval = float('-inf')
            for move in sorted_moves:
                board.push(move)
                eval_score = self._alpha_beta(board, depth - 1, alpha, beta, False)
                board.pop()
                max_eval = max(max_eval, eval_score)
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break  # Beta cutoff
            return max_eval
        else:
            min_eval = float('inf')
            for move in sorted_moves:
                board.push(move)
                eval_score = self._alpha_beta(board, depth - 1, alpha, beta, True)
                board.pop()
                min_eval = min(min_eval, eval_score)
                beta = min(beta, eval_score)
                if beta <= alpha:
                    break  # Alpha cutoff
            return min_eval

    def _order_moves(self, board: chess.Board, moves: List[chess.Move]) -> List[chess.Move]:
        """
        Order moves to improve search efficiency and prioritize aggressive moves.
        
        Priority order:
        1. Checkmate moves (if found)
        2. Checks
        3. Captures (ordered by MVV-LVA: Most Valuable Victim - Least Valuable Attacker)
        4. Threats and attacks
        5. Other moves
        
        Args:
            board: Current board state
            moves: List of legal moves
            
        Returns:
            Ordered list of moves with most promising first
        """
        move_scores: List[Tuple[chess.Move, int]] = []
        
        for move in moves:
            score = 0
            
            # Massive bonus for checks - aggressive players love giving check
            board.push(move)
            if board.is_checkmate():
                score += 100000  # Checkmate is the ultimate goal
            elif board.is_check():
                score += 5000 * self.aggression_factor  # Checks are highly valued
            board.pop()
            
            # Capture bonus using MVV-LVA
            if board.is_capture(move):
                captured_piece = board.piece_at(move.to_square)
                moving_piece = board.piece_at(move.from_square)
                if captured_piece and moving_piece:
                    # MVV-LVA: prefer capturing valuable pieces with less valuable pieces
                    victim_value = self.PIECE_VALUES.get(captured_piece.piece_type, 0)
                    attacker_value = self.PIECE_VALUES.get(moving_piece.piece_type, 0)
                    score += (victim_value * 10 - attacker_value) * self.aggression_factor
            
            # Bonus for moves toward the enemy king (king hunt)
            enemy_king_square = board.king(not board.turn)
            if enemy_king_square is not None:
                moving_piece = board.piece_at(move.from_square)
                if moving_piece:
                    # Calculate distance to enemy king
                    from_distance = chess.square_distance(move.from_square, enemy_king_square)
                    to_distance = chess.square_distance(move.to_square, enemy_king_square)
                    if to_distance < from_distance:
                        score += (from_distance - to_distance) * 50 * self.aggression_factor
            
            # Bonus for central squares (e4, d4, e5, d5)
            central_squares = [chess.E4, chess.D4, chess.E5, chess.D5]
            if move.to_square in central_squares:
                score += 100
            
            # Bonus for piece development in opening
            if len(self.move_history) < 10:
                moving_piece = board.piece_at(move.from_square)
                if moving_piece and moving_piece.piece_type in [chess.KNIGHT, chess.BISHOP]:
                    # Bonus for developing minor pieces
                    if board.turn == chess.WHITE:
                        if move.from_square in [chess.B1, chess.G1, chess.C1, chess.F1]:
                            score += 150
                    else:
                        if move.from_square in [chess.B8, chess.G8, chess.C8, chess.F8]:
                            score += 150
            
            move_scores.append((move, score))
        
        # Sort by score descending
        move_scores.sort(key=lambda x: x[1], reverse=True)
        return [move for move, _ in move_scores]

    def _evaluate_position(self, board: chess.Board) -> float:
        """
        Evaluate the position with heavy emphasis on attacking chances.
        
        Evaluation factors (weighted for aggression):
        - Material balance
        - Piece activity and mobility
        - King safety (attack enemy king, protect own)
        - Central control
        - Piece-square tables favoring aggressive positions
        - Attack potential bonuses
        
        Args:
            board: Current board state
            
        Returns:
            Evaluation score from the perspective of the side to move
                Positive = good for side to move
                Negative = bad for side to move
        """
        if board.is_checkmate():
            return float('-inf')  # We're checkmated
        
        if board.is_stalemate() or board.is_insufficient_material():
            return 0
        
        score = 0.0
        
        # Determine if we're in endgame (for king table selection)
        total_material = self._count_material(board)
        is_endgame = total_material < 2600  # Roughly when queens are off
        
        # Material evaluation
        score += self._evaluate_material(board)
        
        # Piece-square table evaluation
        score += self._evaluate_piece_squares(board, is_endgame)
        
        # Mobility evaluation - more moves = more attacking chances
        score += self._evaluate_mobility(board) * self.aggression_factor
        
        # King safety evaluation - attack enemy king, protect own
        score += self._evaluate_king_safety(board) * self.aggression_factor
        
        # Central control bonus
        score += self._evaluate_center_control(board)
        
        # Attack potential bonus
        score += self._evaluate_attack_potential(board) * self.aggression_factor
        
        # Development bonus in opening
        if len(self.move_history) < 20:
            score += self._evaluate_development(board)
        
        # Return from perspective of side to move
        return score if board.turn == chess.WHITE else -score

    def _count_material(self, board: chess.Board) -> int:
        """Count total material on the board (excluding kings)."""
        total = 0
        for piece_type in [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]:
            total += len(board.pieces(piece_type, chess.WHITE)) * self.PIECE_VALUES[piece_type]
            total += len(board.pieces(piece_type, chess.BLACK)) * self.PIECE_VALUES[piece_type]
        return total

    def _evaluate_material(self, board: chess.Board) -> float:
        """Evaluate material balance."""
        score = 0.0
        for piece_type in self.PIECE_VALUES:
            white_count = len(board.pieces(piece_type, chess.WHITE))
            black_count = len(board.pieces(piece_type, chess.BLACK))
            score += (white_count - black_count) * self.PIECE_VALUES[piece_type]
        return score

    def _evaluate_piece_squares(self, board: chess.Board, is_endgame: bool) -> float:
        """Evaluate piece placement using piece-square tables."""
        score = 0.0
        
        piece_tables = {
            chess.PAWN: self.PAWN_TABLE,
            chess.KNIGHT: self.KNIGHT_TABLE,
            chess.BISHOP: self.BISHOP_TABLE,
            chess.ROOK: self.ROOK_TABLE,
            chess.QUEEN: self.QUEEN_TABLE,
            chess.KING: self.KING_ENDGAME_TABLE if is_endgame else self.KING_MIDDLEGAME_TABLE
        }
        
        for piece_type, table in piece_tables.items():
            # White pieces
            for square in board.pieces(piece_type, chess.WHITE):
                score += table[chess.square_mirror(square)]
            # Black pieces (flip the table)
            for square in board.pieces(piece_type, chess.BLACK):
                score -= table[square]
        
        return score

    def _evaluate_mobility(self, board: chess.Board) -> float:
        """
        Evaluate piece mobility - more legal moves = better attacking chances.
        """
        # Count legal moves for current side
        current_mobility = len(list(board.legal_moves))
        
        # Switch sides and count opponent's mobility
        board.push(chess.Move.null())
        opponent_mobility = len(list(board.legal_moves)) if not board.is_valid() else 0
        # Handle invalid null move case
        try:
            opponent_mobility = len(list(board.legal_moves))
        except:
            opponent_mobility = 0
        board.pop()
        
        # Mobility difference with bonus for having more options
        mobility_score = (current_mobility - opponent_mobility) * 5
        
        # Extra bonus for having many attacking moves
        if current_mobility > 30:
            mobility_score += 20
        
        return mobility_score if board.turn == chess.WHITE else -mobility_score

    def _evaluate_king_safety(self, board: chess.Board) -> float:
        """
        Evaluate king safety with focus on attacking the enemy king.
        
        Heavily rewards:
        - Pieces attacking squares near enemy king
        - Open files/diagonals toward enemy king
        - Pawn storms toward enemy king
        
        Penalizes:
        - Exposed own king
        """
        score = 0.0
        
        white_king = board.king(chess.WHITE)
        black_king = board.king(chess.BLACK)
        
        if white_king is None or black_king is None:
            return 0.0
        
        # Evaluate attacks on black king (bonus for white)
        score += self._count_king_attackers(board, chess.BLACK) * 30
        
        # Evaluate attacks on white king (penalty for white)
        score -= self._count_king_attackers(board, chess.WHITE) * 30
        
        # Bonus for pieces near enemy king
        score += self._pieces_near_king(board, chess.WHITE, black_king) * 15
        score -= self._pieces_near_king(board, chess.BLACK, white_king) * 15
        
        # Pawn shield evaluation
        score += self._evaluate_pawn_shield(board, chess.WHITE, white_king) * 0.5
        score -= self._evaluate_pawn_shield(board, chess.BLACK, black_king) * 0.5
        
        return score

    def _count_king_attackers(self, board: chess.Board, defending_color: bool) -> int:
        """Count pieces attacking squares around the enemy king."""
        king_square = board.king(defending_color)
        if king_square is None:
            return 0
        
        attacking_color = not defending_color
        attackers = 0
        
        # Check attacks on king square and surrounding squares
        king_zone = list(board.attacks(king_square)) + [king_square]
        
        for square in king_zone:
            attackers += len(board.attackers(attacking_color, square))
        
        return attackers

    def _pieces_near_king(self, board: chess.Board, piece_color: bool, 
                          enemy_king_square: int) -> int:
        """Count pieces near the enemy king."""
        count = 0
        for piece_type in [chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]:
            for square in board.pieces(piece_type, piece_color):
                distance = chess.square_distance(square, enemy_king_square)
                if distance <= 3:
                    count += (4 - distance)  # Closer = more points
        return count

    def _evaluate_pawn_shield(self, board: chess.Board, color: bool, 
                              king_square: int) -> float:
        """Evaluate pawn shield in front of the king."""
        score = 0.0
        king_file = chess.square_file(king_square)
        king_rank = chess.square_rank(king_square)
        
        # Direction of pawn shield
        direction = 1 if color == chess.WHITE else -1
        
        # Check pawns in front of king
        for file_offset in [-1, 0, 1]:
            check_file = king_file + file_offset
            if 0 <= check_file <= 7:
                check_rank = king_rank + direction
                if 0 <= check_rank <= 7:
                    square = chess.square(check_file, check_rank)
                    piece = board.piece_at(square)
                    if piece and piece.piece_type == chess.PAWN and piece.color == color:
                        score += 10
        
        return score

    def _evaluate_center_control(self, board: chess.Board) -> float:
        """Evaluate control of central squares."""
        score = 0.0
        center_squares = [chess.E4, chess.D4, chess.E5, chess.D5]
        extended_center = [chess.C3, chess.D3, chess.E3, chess.F3,
                          chess.C4, chess.F4, chess.C5, chess.F5,
                          chess.C6, chess.D6, chess.E6, chess.F6]
        
        for square in center_squares:
            white_attackers = len(board.attackers(chess.WHITE, square))
            black_attackers = len(board.attackers(chess.BLACK, square))
            score += (white_attackers - black_attackers) * 15
            
            # Bonus for occupying center
            piece = board.piece_at(square)
            if piece:
                if piece.color == chess.WHITE:
                    score += 20
                else:
                    score -= 20
        
        for square in extended_center:
            white_attackers = len(board.attackers(chess.WHITE, square))
            black_attackers = len(board.attackers(chess.BLACK, square))
            score += (white_attackers - black_attackers) * 5
        
        return score

    def _evaluate_attack_potential(self, board: chess.Board) -> float:
        """
        Evaluate attacking potential based on piece coordination and threats.
        """
        score = 0.0
        
        # Bonus for having both bishops (bishop pair)
        if len(board.pieces(chess.BISHOP, chess.WHITE)) >= 2:
            score += 50
        if len(board.pieces(chess.BISHOP, chess.BLACK)) >= 2:
            score -= 50
        
        # Bonus for rooks on open files
        for square in board.pieces(chess.ROOK, chess.WHITE):
            if self._is_open_file(board, chess.square_file(square)):
                score += 25
        for square in board.pieces(chess.ROOK, chess.BLACK):
            if self._is_open_file(board, chess.square_file(square)):
                score -= 25
        
        # Bonus for connected rooks
        white_rooks = list(board.pieces(chess.ROOK, chess.WHITE))
        if len(white_rooks) == 2:
            if chess.square_rank(white_rooks[0]) == chess.square_rank(white_rooks[1]):
                score += 15
        
        black_rooks = list(board.pieces(chess.ROOK, chess.BLACK))
        if len(black_rooks) == 2:
            if chess.square_rank(black_rooks[0]) == chess.square_rank(black_rooks[1]):
                score -= 15
        
        # Bonus for queen and knight coordination (dangerous attacking duo)
        if board.pieces(chess.QUEEN, chess.WHITE) and board.pieces(chess.KNIGHT, chess.WHITE):
            score += 20
        if board.pieces(chess.QUEEN, chess.BLACK) and board.pieces(chess.KNIGHT, chess.BLACK):
            score -= 20
        
        return score

    def _is_open_file(self, board: chess.Board, file: int) -> bool:
        """Check if a file has no pawns on it."""
        for rank in range(8):
            square = chess.square(file, rank)
            piece = board.piece_at(square)
            if piece and piece.piece_type == chess.PAWN:
                return False
        return True

    def _evaluate_development(self, board: chess.Board) -> float:
        """Evaluate piece development in the opening."""
        score = 0.0
        
        # Penalty for undeveloped minor pieces (still on starting squares)
        white_start_minors = [chess.B1, chess.G1, chess.C1, chess.F1]
        black_start_minors = [chess.B8, chess.G8, chess.C8, chess.F8]
        
        for square in white_start_minors:
            piece = board.piece_at(square)
            if piece and piece.color == chess.WHITE:
                if piece.piece_type in [chess.KNIGHT, chess.BISHOP]:
                    score -= 30
        
        for square in black_start_minors:
            piece = board.piece_at(square)
            if piece and piece.color == chess.BLACK:
                if piece.piece_type in [chess.KNIGHT, chess.BISHOP]:
                    score += 30
        
        # Bonus for castling rights lost (implies castled)
        if not board.has_kingside_castling_rights(chess.WHITE) or \
           not board.has_queenside_castling_rights(chess.WHITE):
            if board.king(chess.WHITE) in [chess.G1, chess.C1]:
                score += 40  # Castled bonus
        
        if not board.has_kingside_castling_rights(chess.BLACK) or \
           not board.has_queenside_castling_rights(chess.BLACK):
            if board.king(chess.BLACK) in [chess.G8, chess.C8]:
                score -= 40  # Castled bonus for black
        
        return score

    def reset(self) -> None:
        """Reset the player state for a new game."""
        self.move_history.clear()

    def get_aggression_level(self) -> str:
        """Get a description of the current aggression level."""
        if self.aggression_factor < 1.0:
            return "Conservative"
        elif self.aggression_factor < 1.5:
            return "Moderate"
        elif self.aggression_factor < 2.0:
            return "Aggressive"
        else:
            return "Ultra-Aggressive"


# Convenience function for quick usage
def get_best_move(board: chess.Board, aggression: float = 1.5) -> Optional[chess.Move]:
    """
    Get the best aggressive move for the given position.
    
    Args:
        board: Current chess board state
        aggression: Aggression factor (default 1.5, higher = more aggressive)
        
    Returns:
        Best move according to aggressive evaluation
    """
    attacker = AggressiveAttacker(aggression_factor=aggression)
    return attacker.get_best_move(board)


# Example usage
if __name__ == "__main__":
    # Create a board and demonstrate aggressive play
    board = chess.Board()
    attacker = AggressiveAttacker(aggression_factor=1.5)
    
    print("Aggressive Attacker Chess Player")
    print("=" * 40)
    print(f"Aggression Level: {attacker.get_aggression_level()}")
    print()
    print("Starting position:")
    print(board)
    print()
    
    # Play a few moves
    for i in range(5):
        move = attacker.get_best_move(board)
        if move:
            print(f"Move {i + 1}: {board.san(move)}")
            board.push(move)
            
            # Opponent makes a simple response (just for demonstration)
            opponent_moves = list(board.legal_moves)
            if opponent_moves:
                board.push(opponent_moves[0])
        else:
            break
    
    print()
    print("Position after 5 moves:")
    print(board)
