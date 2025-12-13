"""
Defensive Chess Player Implementation

This module implements a defensive/positional chess player that prioritizes:
- King safety and pawn shield integrity
- Solid pawn structure over material gains
- Piece coordination and defensive positioning
- Prophylactic moves that prevent opponent's plans
- Avoiding weaknesses and maintaining strong defensive positions

The player uses minimax search with alpha-beta pruning and a carefully
tuned evaluation function that heavily weights defensive considerations.
"""

import chess
from typing import Optional, Tuple, List


class DefensiveChessPlayer:
    """
    A defensive/positional chess player that prioritizes safety and solid positions.
    
    This player employs a conservative strategy that focuses on:
    - Maintaining a strong pawn shield around the king
    - Keeping a solid, connected pawn structure
    - Coordinating pieces for mutual defense
    - Making prophylactic moves to prevent opponent threats
    - Avoiding creating weaknesses in the position
    
    The evaluation function is heavily biased toward defensive considerations,
    often preferring a slightly worse but solid position over a risky advantage.
    """
    
    # Piece values (centipawns)
    PIECE_VALUES = {
        chess.PAWN: 100,
        chess.KNIGHT: 320,
        chess.BISHOP: 330,
        chess.ROOK: 500,
        chess.QUEEN: 900,
        chess.KING: 20000
    }
    
    # Defensive piece-square tables (encourage centralization and defensive positioning)
    # Values are from White's perspective, flipped for Black
    PAWN_TABLE = [
        0,   0,   0,   0,   0,   0,   0,   0,
        50,  50,  50,  50,  50,  50,  50,  50,
        10,  10,  20,  30,  30,  20,  10,  10,
        5,   5,   10,  25,  25,  10,   5,   5,
        0,   0,   0,   20,  20,   0,   0,   0,
        5,  -5,  -10,  0,   0,  -10, -5,   5,
        5,   10,  10, -20, -20,  10,  10,   5,
        0,   0,   0,   0,   0,   0,   0,   0
    ]
    
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
    
    # King tables - different for middlegame (stay safe) vs endgame (centralize)
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
    
    def __init__(self, name: str = 'Defensive Player', search_depth: int = 3):
        """
        Initialize the defensive chess player.
        
        Args:
            name: The name of this player
            search_depth: How many moves ahead to search (default 3)
        """
        self.name = name
        self.search_depth = search_depth
        self.nodes_searched = 0
    
    def _is_endgame(self, board: chess.Board) -> bool:
        """
        Determine if the position is an endgame.
        
        Endgame is defined as: no queens, or each side has at most
        one minor piece in addition to their queen.
        
        Args:
            board: The current board position
            
        Returns:
            True if the position is an endgame, False otherwise
        """
        queens = len(board.pieces(chess.QUEEN, chess.WHITE)) + len(board.pieces(chess.QUEEN, chess.BLACK))
        
        if queens == 0:
            return True
        
        white_minor = len(board.pieces(chess.KNIGHT, chess.WHITE)) + len(board.pieces(chess.BISHOP, chess.WHITE))
        black_minor = len(board.pieces(chess.KNIGHT, chess.BLACK)) + len(board.pieces(chess.BISHOP, chess.BLACK))
        white_major = len(board.pieces(chess.ROOK, chess.WHITE)) + len(board.pieces(chess.QUEEN, chess.WHITE))
        black_major = len(board.pieces(chess.ROOK, chess.BLACK)) + len(board.pieces(chess.QUEEN, chess.BLACK))
        
        return (white_minor <= 1 and black_minor <= 1 and white_major <= 1 and black_major <= 1)
    
    def _get_piece_square_value(self, piece: chess.Piece, square: int, is_endgame: bool) -> int:
        """
        Get the piece-square table value for a piece on a given square.
        
        Args:
            piece: The chess piece
            square: The square (0-63)
            is_endgame: Whether the position is an endgame
            
        Returns:
            The piece-square table bonus/penalty
        """
        # For black pieces, flip the square vertically
        if piece.color == chess.BLACK:
            square = chess.square_mirror(square)
        
        if piece.piece_type == chess.PAWN:
            return self.PAWN_TABLE[square]
        elif piece.piece_type == chess.KNIGHT:
            return self.KNIGHT_TABLE[square]
        elif piece.piece_type == chess.BISHOP:
            return self.BISHOP_TABLE[square]
        elif piece.piece_type == chess.ROOK:
            return self.ROOK_TABLE[square]
        elif piece.piece_type == chess.QUEEN:
            return self.QUEEN_TABLE[square]
        elif piece.piece_type == chess.KING:
            if is_endgame:
                return self.KING_ENDGAME_TABLE[square]
            return self.KING_MIDDLEGAME_TABLE[square]
        return 0
    
    def _evaluate_king_safety(self, board: chess.Board, color: chess.Color) -> int:
        """
        Evaluate king safety for the given color.
        
        This is a crucial component of the defensive evaluation, considering:
        - Pawn shield integrity
        - Open files near the king
        - Attacking pieces near the king
        - Castling rights
        
        Args:
            board: The current board position
            color: The color to evaluate for
            
        Returns:
            King safety score (positive is safer)
        """
        king_square = board.king(color)
        if king_square is None:
            return -10000
        
        safety_score = 0
        king_file = chess.square_file(king_square)
        king_rank = chess.square_rank(king_square)
        
        # Bonus for castling rights (encourages keeping them)
        if color == chess.WHITE:
            if board.has_kingside_castling_rights(chess.WHITE):
                safety_score += 20
            if board.has_queenside_castling_rights(chess.WHITE):
                safety_score += 15
        else:
            if board.has_kingside_castling_rights(chess.BLACK):
                safety_score += 20
            if board.has_queenside_castling_rights(chess.BLACK):
                safety_score += 15
        
        # Evaluate pawn shield
        pawn_shield_bonus = 0
        shield_squares = []
        
        if color == chess.WHITE:
            # Check pawns in front of king
            for file_offset in [-1, 0, 1]:
                f = king_file + file_offset
                if 0 <= f <= 7:
                    for r in [king_rank + 1, king_rank + 2]:
                        if 0 <= r <= 7:
                            shield_squares.append(chess.square(f, r))
        else:
            for file_offset in [-1, 0, 1]:
                f = king_file + file_offset
                if 0 <= f <= 7:
                    for r in [king_rank - 1, king_rank - 2]:
                        if 0 <= r <= 7:
                            shield_squares.append(chess.square(f, r))
        
        for sq in shield_squares:
            piece = board.piece_at(sq)
            if piece and piece.piece_type == chess.PAWN and piece.color == color:
                pawn_shield_bonus += 15
        
        safety_score += pawn_shield_bonus
        
        # Penalty for open files near king
        for file_offset in [-1, 0, 1]:
            f = king_file + file_offset
            if 0 <= f <= 7:
                has_own_pawn = False
                has_enemy_pawn = False
                for r in range(8):
                    piece = board.piece_at(chess.square(f, r))
                    if piece and piece.piece_type == chess.PAWN:
                        if piece.color == color:
                            has_own_pawn = True
                        else:
                            has_enemy_pawn = True
                
                if not has_own_pawn and not has_enemy_pawn:
                    safety_score -= 25  # Open file penalty
                elif not has_own_pawn:
                    safety_score -= 15  # Semi-open file penalty
        
        # Penalty for enemy pieces attacking squares near king
        enemy_color = not color
        king_zone = list(board.attacks(king_square))
        king_zone.append(king_square)
        
        attackers_count = 0
        for sq in king_zone:
            attackers = board.attackers(enemy_color, sq)
            attackers_count += len(attackers)
        
        safety_score -= attackers_count * 8
        
        return safety_score
    
    def _evaluate_pawn_structure(self, board: chess.Board, color: chess.Color) -> int:
        """
        Evaluate pawn structure for the given color.
        
        Defensive players value solid pawn structure highly:
        - Connected pawns are good
        - Doubled pawns are bad
        - Isolated pawns are very bad
        - Backward pawns are bad
        - Passed pawns are valuable
        
        Args:
            board: The current board position
            color: The color to evaluate for
            
        Returns:
            Pawn structure score
        """
        score = 0
        pawns = list(board.pieces(chess.PAWN, color))
        
        pawn_files = [chess.square_file(p) for p in pawns]
        
        for pawn_sq in pawns:
            pawn_file = chess.square_file(pawn_sq)
            pawn_rank = chess.square_rank(pawn_sq)
            
            # Check for doubled pawns
            if pawn_files.count(pawn_file) > 1:
                score -= 20
            
            # Check for isolated pawns (no friendly pawns on adjacent files)
            has_neighbor = False
            for adj_file in [pawn_file - 1, pawn_file + 1]:
                if adj_file in pawn_files:
                    has_neighbor = True
                    break
            
            if not has_neighbor:
                score -= 25  # Isolated pawn penalty
            
            # Check for connected pawns
            for adj_file in [pawn_file - 1, pawn_file + 1]:
                if 0 <= adj_file <= 7:
                    adj_rank = pawn_rank if color == chess.WHITE else pawn_rank
                    for r_offset in [-1, 0, 1]:
                        check_rank = pawn_rank + r_offset
                        if 0 <= check_rank <= 7:
                            adj_sq = chess.square(adj_file, check_rank)
                            piece = board.piece_at(adj_sq)
                            if piece and piece.piece_type == chess.PAWN and piece.color == color:
                                score += 10  # Connected pawn bonus
                                break
            
            # Check for passed pawn
            is_passed = True
            enemy_color = not color
            direction = 1 if color == chess.WHITE else -1
            
            for check_file in [pawn_file - 1, pawn_file, pawn_file + 1]:
                if 0 <= check_file <= 7:
                    check_rank = pawn_rank + direction
                    while 0 <= check_rank <= 7:
                        sq = chess.square(check_file, check_rank)
                        piece = board.piece_at(sq)
                        if piece and piece.piece_type == chess.PAWN and piece.color == enemy_color:
                            is_passed = False
                            break
                        check_rank += direction
                if not is_passed:
                    break
            
            if is_passed:
                # Passed pawn bonus increases as it advances
                if color == chess.WHITE:
                    score += 20 + (pawn_rank * 10)
                else:
                    score += 20 + ((7 - pawn_rank) * 10)
        
        return score
    
    def _evaluate_piece_coordination(self, board: chess.Board, color: chess.Color) -> int:
        """
        Evaluate piece coordination and defensive potential.
        
        Defensive players value:
        - Pieces defending each other
        - Control of key squares
        - Pieces on secure squares
        
        Args:
            board: The current board position
            color: The color to evaluate for
            
        Returns:
            Piece coordination score
        """
        score = 0
        
        # Bonus for pieces defending other pieces
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece and piece.color == color and piece.piece_type != chess.KING:
                defenders = board.attackers(color, square)
                # Each defender adds a small bonus
                score += len(defenders) * 5
                
                # Penalty if piece is attacked and not defended
                attackers = board.attackers(not color, square)
                if len(attackers) > len(defenders):
                    score -= 15
        
        # Bonus for controlling center squares
        center_squares = [chess.D4, chess.D5, chess.E4, chess.E5]
        for sq in center_squares:
            if len(board.attackers(color, sq)) > 0:
                score += 8
        
        # Bonus for bishop pair
        bishops = list(board.pieces(chess.BISHOP, color))
        if len(bishops) >= 2:
            score += 30
        
        # Bonus for rooks on open files
        rooks = list(board.pieces(chess.ROOK, color))
        for rook_sq in rooks:
            rook_file = chess.square_file(rook_sq)
            is_open = True
            is_semi_open = True
            for r in range(8):
                piece = board.piece_at(chess.square(rook_file, r))
                if piece and piece.piece_type == chess.PAWN:
                    if piece.color == color:
                        is_semi_open = False
                    is_open = False
            
            if is_open:
                score += 20
            elif is_semi_open:
                score += 10
        
        return score
    
    def evaluate_position(self, board: chess.Board) -> int:
        """
        Evaluate the board position with a strong defensive bias.
        
        This evaluation function prioritizes:
        1. Material balance
        2. King safety (heavily weighted)
        3. Pawn structure integrity
        4. Piece coordination and defensive positioning
        
        Args:
            board: The current board position
            
        Returns:
            Evaluation score in centipawns (positive favors White)
        """
        if board.is_checkmate():
            if board.turn == chess.WHITE:
                return -100000
            return 100000
        
        if board.is_stalemate() or board.is_insufficient_material():
            return 0
        
        if board.can_claim_draw():
            return 0
        
        is_endgame = self._is_endgame(board)
        score = 0
        
        # Material and piece-square evaluation
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece:
                value = self.PIECE_VALUES[piece.piece_type]
                value += self._get_piece_square_value(piece, square, is_endgame)
                
                if piece.color == chess.WHITE:
                    score += value
                else:
                    score -= value
        
        # King safety (heavily weighted for defensive play)
        king_safety_weight = 2.0 if not is_endgame else 0.5
        white_king_safety = self._evaluate_king_safety(board, chess.WHITE)
        black_king_safety = self._evaluate_king_safety(board, chess.BLACK)
        score += int((white_king_safety - black_king_safety) * king_safety_weight)
        
        # Pawn structure (important for defensive play)
        pawn_structure_weight = 1.5
        white_pawn_structure = self._evaluate_pawn_structure(board, chess.WHITE)
        black_pawn_structure = self._evaluate_pawn_structure(board, chess.BLACK)
        score += int((white_pawn_structure - black_pawn_structure) * pawn_structure_weight)
        
        # Piece coordination
        white_coordination = self._evaluate_piece_coordination(board, chess.WHITE)
        black_coordination = self._evaluate_piece_coordination(board, chess.BLACK)
        score += white_coordination - black_coordination
        
        # Defensive bonus: prefer positions with fewer attacking chances for opponent
        # Penalty for being in check
        if board.is_check():
            if board.turn == chess.WHITE:
                score -= 50
            else:
                score += 50
        
        return score
    
    def _minimax(self, board: chess.Board, depth: int, alpha: int, beta: int, 
                 maximizing: bool) -> Tuple[int, Optional[chess.Move]]:
        """
        Minimax search with alpha-beta pruning.
        
        Args:
            board: The current board position
            depth: Remaining search depth
            alpha: Alpha value for pruning
            beta: Beta value for pruning
            maximizing: True if maximizing player (White)
            
        Returns:
            Tuple of (evaluation score, best move)
        """
        self.nodes_searched += 1
        
        if depth == 0 or board.is_game_over():
            return self.evaluate_position(board), None
        
        best_move = None
        
        # Move ordering: check captures and checks first for better pruning
        moves = list(board.legal_moves)
        
        def move_priority(move: chess.Move) -> int:
            priority = 0
            if board.is_capture(move):
                priority += 100
                # MVV-LVA: Most Valuable Victim - Least Valuable Attacker
                victim = board.piece_at(move.to_square)
                attacker = board.piece_at(move.from_square)
                if victim:
                    priority += self.PIECE_VALUES.get(victim.piece_type, 0)
                if attacker:
                    priority -= self.PIECE_VALUES.get(attacker.piece_type, 0) // 10
            
            board.push(move)
            if board.is_check():
                priority += 50
            board.pop()
            
            return priority
        
        moves.sort(key=move_priority, reverse=True)
        
        if maximizing:
            max_eval = float('-inf')
            for move in moves:
                board.push(move)
                eval_score, _ = self._minimax(board, depth - 1, alpha, beta, False)
                board.pop()
                
                if eval_score > max_eval:
                    max_eval = eval_score
                    best_move = move
                
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break
            
            return max_eval, best_move
        else:
            min_eval = float('inf')
            for move in moves:
                board.push(move)
                eval_score, _ = self._minimax(board, depth - 1, alpha, beta, True)
                board.pop()
                
                if eval_score < min_eval:
                    min_eval = eval_score
                    best_move = move
                
                beta = min(beta, eval_score)
                if beta <= alpha:
                    break
            
            return min_eval, best_move
    
    def get_best_move(self, board: chess.Board) -> Optional[chess.Move]:
        """
        Get the best move for the current position using minimax with alpha-beta pruning.
        
        The defensive player searches for moves that maintain safety while
        seeking small advantages. It will avoid risky tactical complications
        in favor of solid, positional play.
        
        Args:
            board: The current board position
            
        Returns:
            The best move found, or None if no legal moves
        """
        if board.is_game_over():
            return None
        
        self.nodes_searched = 0
        maximizing = board.turn == chess.WHITE
        
        _, best_move = self._minimax(
            board, 
            self.search_depth, 
            float('-inf'), 
            float('inf'), 
            maximizing
        )
        
        return best_move
    
    def play_turn(self, board: chess.Board) -> Optional[chess.Move]:
        """
        Execute a turn and return the move made.
        
        This method finds the best move according to the defensive strategy
        and applies it to the board.
        
        Args:
            board: The current board position (will be modified)
            
        Returns:
            The move that was made, or None if the game is over
        """
        move = self.get_best_move(board)
        
        if move:
            board.push(move)
            return move
        
        return None


def main():
    """
    Demonstrate the defensive chess player with a sample game.
    """
    print("=" * 60)
    print("Defensive Chess Player Demonstration")
    print("=" * 60)
    
    # Create a defensive player
    player = DefensiveChessPlayer(name="Fortress", search_depth=3)
    
    # Create a new board
    board = chess.Board()
    
    print(f"\nPlayer: {player.name}")
    print(f"Search Depth: {player.search_depth}")
    print("\nStarting position:")
    print(board)
    
    # Play a few moves to demonstrate
    print("\n" + "-" * 40)
    print("Playing first 10 moves (5 per side)...")
    print("-" * 40)
    
    move_count = 0
    while not board.is_game_over() and move_count < 10:
        move = player.play_turn(board)
        if move:
            # Show the move in standard algebraic notation
            print(f"Move {move_count // 2 + 1}{'.' if board.turn == chess.BLACK else '...'} "
                  f"{board.peek().uci()} (nodes searched: {player.nodes_searched})")
            move_count += 1
    
    print("\n" + "-" * 40)
    print("Position after opening moves:")
    print("-" * 40)
    print(board)
    
    # Show evaluation
    evaluation = player.evaluate_position(board)
    print(f"\nPosition evaluation: {evaluation/100:.2f} pawns")
    if evaluation > 0:
        print("(Slightly favorable for White)")
    elif evaluation < 0:
        print("(Slightly favorable for Black)")
    else:
        print("(Equal position)")
    
    # Demonstrate evaluation on a specific defensive position
    print("\n" + "=" * 60)
    print("Testing on a position requiring defensive play...")
    print("=" * 60)
    
    # Italian Game position where defense is important
    test_board = chess.Board("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4")
    print("\nItalian Game position:")
    print(test_board)
    
    # Get the defensive player's move
    move = player.get_best_move(test_board)
    print(f"\nDefensive player's choice: {move}")
    print(f"Nodes searched: {player.nodes_searched}")
    
    evaluation = player.evaluate_position(test_board)
    print(f"Position evaluation: {evaluation/100:.2f} pawns")
    
    print("\n" + "=" * 60)
    print("Demonstration complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
