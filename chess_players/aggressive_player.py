"""
Aggressive Chess Player Strategy

This module implements an AGGRESSIVE chess playing strategy that prioritizes:
1. Attacking moves and capturing opponent pieces
2. Control of the center of the board
3. Moves that put pressure on the opponent's king
4. Material advantage and attacking potential

Uses minimax algorithm with alpha-beta pruning at depth 3-4.
"""

import chess
from typing import Optional, Tuple, List

# Piece values for material evaluation
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000
}

# Bonus for controlling center squares (e4, d4, e5, d5)
CENTER_SQUARES = [chess.E4, chess.D4, chess.E5, chess.D5]

# Extended center squares for additional control bonus
EXTENDED_CENTER = [
    chess.C3, chess.D3, chess.E3, chess.F3,
    chess.C4, chess.F4,
    chess.C5, chess.F5,
    chess.C6, chess.D6, chess.E6, chess.F6
]

# Squares near the king that are valuable to attack
KING_ZONE_OFFSETS = [
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1), (0, 0), (0, 1),
    (1, -1), (1, 0), (1, 1)
]


class AggressivePlayer:
    """
    An aggressive chess player that prioritizes attacks and captures.
    
    Strategy Overview:
    - Maximize material advantage through captures
    - Control the center to enable piece mobility
    - Attack the opponent's king zone
    - Prefer active piece placement over passive defense
    """
    
    def __init__(self, depth: int = 3):
        """
        Initialize the aggressive player.
        
        Args:
            depth: Search depth for minimax algorithm (3-4 recommended)
        """
        self.depth = depth
        self.nodes_evaluated = 0
    
    def get_best_move(self, board: chess.Board) -> Optional[chess.Move]:
        """
        Get the best move for the current position using minimax with alpha-beta pruning.
        
        Args:
            board: Current chess board state
            
        Returns:
            The best move found, or None if no legal moves available
        """
        self.nodes_evaluated = 0
        
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            return None
        
        # Sort moves to improve alpha-beta pruning efficiency
        # Captures and checks are evaluated first (aggressive priority)
        sorted_moves = self._order_moves(board, legal_moves)
        
        best_move = None
        best_value = float('-inf') if board.turn == chess.WHITE else float('inf')
        alpha = float('-inf')
        beta = float('inf')
        
        for move in sorted_moves:
            board.push(move)
            
            if board.turn == chess.BLACK:  # We just played as white
                value = self._minimax(board, self.depth - 1, alpha, beta, False)
                if value > best_value:
                    best_value = value
                    best_move = move
                alpha = max(alpha, value)
            else:  # We just played as black
                value = self._minimax(board, self.depth - 1, alpha, beta, True)
                if value < best_value:
                    best_value = value
                    best_move = move
                beta = min(beta, value)
            
            board.pop()
        
        return best_move
    
    def _minimax(self, board: chess.Board, depth: int, alpha: float, beta: float, 
                 maximizing: bool) -> float:
        """
        Minimax algorithm with alpha-beta pruning.
        
        Args:
            board: Current board state
            depth: Remaining search depth
            alpha: Alpha value for pruning
            beta: Beta value for pruning
            maximizing: True if maximizing player (white), False if minimizing (black)
            
        Returns:
            Evaluation score for the position
        """
        self.nodes_evaluated += 1
        
        # Terminal conditions
        if depth == 0 or board.is_game_over():
            return self._evaluate_position(board)
        
        legal_moves = list(board.legal_moves)
        sorted_moves = self._order_moves(board, legal_moves)
        
        if maximizing:
            max_eval = float('-inf')
            for move in sorted_moves:
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
            for move in sorted_moves:
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
        Order moves to improve alpha-beta pruning efficiency.
        
        Aggressive ordering prioritizes:
        1. Captures (especially capturing high-value pieces with low-value pieces)
        2. Checks (putting pressure on opponent's king)
        3. Center control moves
        4. Other moves
        
        Args:
            board: Current board state
            moves: List of legal moves to order
            
        Returns:
            Ordered list of moves
        """
        def move_score(move: chess.Move) -> int:
            score = 0
            
            # Prioritize captures - use MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
            if board.is_capture(move):
                captured_piece = board.piece_at(move.to_square)
                moving_piece = board.piece_at(move.from_square)
                if captured_piece and moving_piece:
                    # High value for capturing valuable pieces with less valuable pieces
                    score += 10000 + PIECE_VALUES[captured_piece.piece_type] - PIECE_VALUES[moving_piece.piece_type] // 10
                else:
                    # En passant or other special captures
                    score += 10000
            
            # Prioritize checks - aggressive pressure on the king
            board.push(move)
            if board.is_check():
                score += 5000
            board.pop()
            
            # Bonus for moving to center squares
            if move.to_square in CENTER_SQUARES:
                score += 500
            elif move.to_square in EXTENDED_CENTER:
                score += 200
            
            # Bonus for attacking squares near opponent's king
            opponent_king_square = board.king(not board.turn)
            if opponent_king_square is not None:
                king_file = chess.square_file(opponent_king_square)
                king_rank = chess.square_rank(opponent_king_square)
                to_file = chess.square_file(move.to_square)
                to_rank = chess.square_rank(move.to_square)
                
                # Manhattan distance to opponent's king
                distance = abs(king_file - to_file) + abs(king_rank - to_rank)
                if distance <= 2:
                    score += 300 - distance * 50
            
            # Promotion bonus
            if move.promotion:
                score += PIECE_VALUES.get(move.promotion, 0)
            
            return score
        
        return sorted(moves, key=move_score, reverse=True)
    
    def _evaluate_position(self, board: chess.Board) -> float:
        """
        Evaluate the current board position with an aggressive bias.
        
        Evaluation components:
        1. Material count (basic piece values)
        2. Center control bonus
        3. King attack bonus (pieces attacking opponent's king zone)
        4. Piece activity (mobility)
        5. Checkmate/stalemate detection
        
        Positive scores favor White, negative scores favor Black.
        
        Args:
            board: Board position to evaluate
            
        Returns:
            Evaluation score (centipawns)
        """
        # Check for game-ending positions
        if board.is_checkmate():
            # Whoever just moved delivered checkmate
            return -20000 if board.turn == chess.WHITE else 20000
        
        if board.is_stalemate() or board.is_insufficient_material():
            return 0
        
        score = 0.0
        
        # 1. Material evaluation
        score += self._evaluate_material(board)
        
        # 2. Center control
        score += self._evaluate_center_control(board)
        
        # 3. King attack evaluation - AGGRESSIVE component
        score += self._evaluate_king_attack(board)
        
        # 4. Piece mobility - active pieces are better for aggression
        score += self._evaluate_mobility(board)
        
        # 5. Bonus for having the initiative (being in check is bad)
        if board.is_check():
            score += -50 if board.turn == chess.WHITE else 50
        
        return score
    
    def _evaluate_material(self, board: chess.Board) -> float:
        """
        Calculate material balance.
        
        Args:
            board: Current board state
            
        Returns:
            Material score (positive favors white)
        """
        score = 0.0
        
        for piece_type in PIECE_VALUES:
            white_pieces = len(board.pieces(piece_type, chess.WHITE))
            black_pieces = len(board.pieces(piece_type, chess.BLACK))
            score += PIECE_VALUES[piece_type] * (white_pieces - black_pieces)
        
        return score
    
    def _evaluate_center_control(self, board: chess.Board) -> float:
        """
        Evaluate control of center squares.
        
        Center control enables piece mobility and attacking potential.
        
        Args:
            board: Current board state
            
        Returns:
            Center control score
        """
        score = 0.0
        
        # Direct occupation of center
        for square in CENTER_SQUARES:
            piece = board.piece_at(square)
            if piece:
                value = 30 if piece.color == chess.WHITE else -30
                score += value
        
        # Extended center occupation
        for square in EXTENDED_CENTER:
            piece = board.piece_at(square)
            if piece:
                value = 10 if piece.color == chess.WHITE else -10
                score += value
        
        # Attacks on center squares
        for square in CENTER_SQUARES:
            white_attackers = len(board.attackers(chess.WHITE, square))
            black_attackers = len(board.attackers(chess.BLACK, square))
            score += (white_attackers - black_attackers) * 5
        
        return score
    
    def _evaluate_king_attack(self, board: chess.Board) -> float:
        """
        Evaluate attacking potential against the opponent's king.
        
        This is the core AGGRESSIVE component - rewards positions where
        we have pieces attacking the opponent's king zone.
        
        Args:
            board: Current board state
            
        Returns:
            King attack score
        """
        score = 0.0
        
        # Evaluate attacks on black king (positive for white)
        black_king_square = board.king(chess.BLACK)
        if black_king_square is not None:
            score += self._count_king_zone_attacks(board, black_king_square, chess.WHITE) * 15
        
        # Evaluate attacks on white king (negative for white)
        white_king_square = board.king(chess.WHITE)
        if white_king_square is not None:
            score -= self._count_king_zone_attacks(board, white_king_square, chess.BLACK) * 15
        
        return score
    
    def _count_king_zone_attacks(self, board: chess.Board, king_square: int, 
                                  attacking_color: chess.Color) -> int:
        """
        Count the number of attacks on squares around the king.
        
        Args:
            board: Current board state
            king_square: Square where the king is located
            attacking_color: Color of the attacking side
            
        Returns:
            Number of attacks on king zone
        """
        attacks = 0
        king_file = chess.square_file(king_square)
        king_rank = chess.square_rank(king_square)
        
        for file_offset, rank_offset in KING_ZONE_OFFSETS:
            target_file = king_file + file_offset
            target_rank = king_rank + rank_offset
            
            if 0 <= target_file <= 7 and 0 <= target_rank <= 7:
                target_square = chess.square(target_file, target_rank)
                attackers = board.attackers(attacking_color, target_square)
                attacks += len(attackers)
        
        return attacks
    
    def _evaluate_mobility(self, board: chess.Board) -> float:
        """
        Evaluate piece mobility.
        
        More legal moves = more attacking potential = better for aggression.
        
        Args:
            board: Current board state
            
        Returns:
            Mobility score
        """
        # Count moves for current player
        current_moves = len(list(board.legal_moves))
        
        # Temporarily switch sides to count opponent moves
        board.push(chess.Move.null())
        opponent_moves = len(list(board.legal_moves))
        board.pop()
        
        # Mobility advantage (scaled down to not overshadow material)
        mobility_diff = current_moves - opponent_moves
        
        if board.turn == chess.WHITE:
            return mobility_diff * 2
        else:
            return -mobility_diff * 2


def get_move(board: chess.Board, depth: int = 3) -> Optional[chess.Move]:
    """
    Main function to get the next move for a given board state.
    
    This is the primary interface for using the aggressive player.
    
    Args:
        board: Current chess board state (python-chess Board object)
        depth: Search depth for minimax (default: 3, recommended: 3-4)
        
    Returns:
        The best move found using aggressive strategy, or None if no legal moves
        
    Example:
        >>> import chess
        >>> board = chess.Board()
        >>> move = get_move(board)
        >>> print(f"Best move: {move}")
    """
    player = AggressivePlayer(depth=depth)
    return player.get_best_move(board)


def get_move_from_fen(fen: str, depth: int = 3) -> Optional[str]:
    """
    Get the next move from a FEN string representation.
    
    Convenience function for getting moves from FEN notation.
    
    Args:
        fen: FEN string representing the board position
        depth: Search depth for minimax (default: 3)
        
    Returns:
        UCI string of the best move (e.g., "e2e4"), or None if no legal moves
        
    Example:
        >>> move = get_move_from_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
        >>> print(f"Best move: {move}")
    """
    board = chess.Board(fen)
    move = get_move(board, depth)
    return move.uci() if move else None


def main():
    """
    Main entry point for testing the aggressive player.
    
    Demonstrates the player's behavior from the starting position
    and a tactical position.
    """
    print("=" * 50)
    print("Aggressive Chess Player - Strategy Demo")
    print("=" * 50)
    
    # Test from starting position
    print("\n1. Starting Position:")
    board = chess.Board()
    print(board)
    
    player = AggressivePlayer(depth=3)
    move = player.get_best_move(board)
    print(f"\nBest move: {move}")
    print(f"Nodes evaluated: {player.nodes_evaluated}")
    
    # Test from a tactical position with capture opportunities
    print("\n" + "=" * 50)
    print("2. Tactical Position (White to move, capture available):")
    # Position where white can capture a piece
    tactical_fen = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
    board = chess.Board(tactical_fen)
    print(board)
    
    move = player.get_best_move(board)
    print(f"\nBest move: {move}")
    print(f"Nodes evaluated: {player.nodes_evaluated}")
    
    # Test from a position where aggression can win material
    print("\n" + "=" * 50)
    print("3. Attacking Position (pressure on f7):")
    attacking_fen = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 4"
    board = chess.Board(attacking_fen)
    print(board)
    
    player_depth4 = AggressivePlayer(depth=4)
    move = player_depth4.get_best_move(board)
    print(f"\nBest move (depth 4): {move}")
    print(f"Nodes evaluated: {player_depth4.nodes_evaluated}")
    
    print("\n" + "=" * 50)
    print("Aggressive Player Demo Complete!")


if __name__ == "__main__":
    main()
