"""
Aggressive Chess Player Implementation

This module implements an aggressive chess playing strategy that prioritizes
attacking moves, piece activity, and creating threats over defensive play.
The player is willing to sacrifice material for attacking chances and
consistently seeks to put pressure on the opponent's position.
"""

import chess
from typing import Optional, Tuple, List


class AggressiveChessPlayer:
    """
    An aggressive chess player that prioritizes attacks and threats.
    
    This player uses a minimax algorithm with alpha-beta pruning, but with
    an evaluation function heavily biased toward aggressive play:
    - Captures and attacks are highly valued
    - Piece activity and mobility are prioritized
    - Center control enables attacking chances
    - Pieces aimed at the enemy king receive bonuses
    - Material sacrifices for attacking positions are acceptable
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
    
    # Bonus for attacking squares near enemy king
    KING_ATTACK_BONUS = 15
    
    # Bonus for pieces on aggressive squares (center and enemy territory)
    AGGRESSIVE_POSITION_BONUS = {
        chess.PAWN: 10,
        chess.KNIGHT: 20,
        chess.BISHOP: 15,
        chess.ROOK: 10,
        chess.QUEEN: 25,
        chess.KING: 0
    }
    
    # Center squares for control bonus
    CENTER_SQUARES = [chess.D4, chess.D5, chess.E4, chess.E5]
    EXTENDED_CENTER = [
        chess.C3, chess.C4, chess.C5, chess.C6,
        chess.D3, chess.D4, chess.D5, chess.D6,
        chess.E3, chess.E4, chess.E5, chess.E6,
        chess.F3, chess.F4, chess.F5, chess.F6
    ]
    
    def __init__(self, name: str = 'Aggressive Player', search_depth: int = 3):
        """
        Initialize the aggressive chess player.
        
        Args:
            name: The name of the player
            search_depth: How many moves ahead to search (default 3)
        """
        self.name = name
        self.search_depth = search_depth
        self.nodes_searched = 0
    
    def evaluate_position(self, board: chess.Board) -> float:
        """
        Evaluate the board position with an aggressive bias.
        
        The evaluation prioritizes:
        - Material advantage (but willing to sacrifice for attacks)
        - Attacking potential against enemy king
        - Piece mobility and activity
        - Center control for launching attacks
        - Open files and diagonals for attacking pieces
        - Threats and hanging pieces
        
        Args:
            board: The current chess board position
            
        Returns:
            A score in centipawns from the current player's perspective.
            Positive values favor the side to move.
        """
        if board.is_checkmate():
            return -99999 if board.turn else 99999
        
        if board.is_stalemate() or board.is_insufficient_material():
            return 0
        
        score = 0.0
        
        # Material evaluation
        score += self._evaluate_material(board)
        
        # Aggressive bonuses
        score += self._evaluate_attacks(board)
        score += self._evaluate_king_safety_differential(board)
        score += self._evaluate_piece_activity(board)
        score += self._evaluate_center_control(board)
        score += self._evaluate_threats(board)
        
        # Return score from perspective of side to move
        return score if board.turn == chess.WHITE else -score
    
    def _evaluate_material(self, board: chess.Board) -> float:
        """Calculate material balance."""
        score = 0.0
        for piece_type in self.PIECE_VALUES:
            white_pieces = len(board.pieces(piece_type, chess.WHITE))
            black_pieces = len(board.pieces(piece_type, chess.BLACK))
            score += self.PIECE_VALUES[piece_type] * (white_pieces - black_pieces)
        return score
    
    def _evaluate_attacks(self, board: chess.Board) -> float:
        """
        Evaluate attacking potential - heavily weighted for aggressive play.
        
        Rewards:
        - Pieces attacking enemy pieces
        - Checks and check threats
        - Captures available
        """
        score = 0.0
        
        # Bonus for being in check (we're attacking!)
        if board.is_check():
            score += 50 if board.turn == chess.BLACK else -50
        
        # Count attacks on enemy pieces
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece is None:
                continue
            
            attackers = board.attackers(not piece.color, square)
            attack_value = len(attackers) * 10
            
            # Extra bonus for attacking high-value pieces
            if piece.piece_type in [chess.QUEEN, chess.ROOK]:
                attack_value *= 1.5
            
            if piece.color == chess.WHITE:
                score -= attack_value
            else:
                score += attack_value
        
        return score
    
    def _evaluate_king_safety_differential(self, board: chess.Board) -> float:
        """
        Evaluate attacks near the enemy king vs our king safety.
        
        Aggressive players want to attack the enemy king while
        accepting some risk to their own king.
        """
        score = 0.0
        
        white_king_sq = board.king(chess.WHITE)
        black_king_sq = board.king(chess.BLACK)
        
        if white_king_sq is None or black_king_sq is None:
            return 0.0
        
        # Get squares around each king
        white_king_zone = self._get_king_zone(white_king_sq)
        black_king_zone = self._get_king_zone(black_king_sq)
        
        # Count our attacks on enemy king zone (very valuable for aggressive play)
        for square in black_king_zone:
            white_attackers = len(board.attackers(chess.WHITE, square))
            score += white_attackers * self.KING_ATTACK_BONUS
        
        for square in white_king_zone:
            black_attackers = len(board.attackers(chess.BLACK, square))
            score -= black_attackers * self.KING_ATTACK_BONUS
        
        # Penalize castling rights loss less for aggressive play (we want to attack!)
        # Only a small penalty since aggressive players often delay castling
        if not board.has_kingside_castling_rights(chess.WHITE) and not board.has_queenside_castling_rights(chess.WHITE):
            score -= 10
        if not board.has_kingside_castling_rights(chess.BLACK) and not board.has_queenside_castling_rights(chess.BLACK):
            score += 10
        
        return score
    
    def _get_king_zone(self, king_square: chess.Square) -> List[chess.Square]:
        """Get squares in the king's zone (king + surrounding squares)."""
        zone = [king_square]
        king_file = chess.square_file(king_square)
        king_rank = chess.square_rank(king_square)
        
        for df in [-1, 0, 1]:
            for dr in [-1, 0, 1]:
                if df == 0 and dr == 0:
                    continue
                f, r = king_file + df, king_rank + dr
                if 0 <= f <= 7 and 0 <= r <= 7:
                    zone.append(chess.square(f, r))
        
        return zone
    
    def _evaluate_piece_activity(self, board: chess.Board) -> float:
        """
        Evaluate piece mobility and activity.
        
        Aggressive players value active pieces that can participate in attacks.
        """
        score = 0.0
        
        # Store original turn
        original_turn = board.turn
        
        # Evaluate white piece activity
        board.turn = chess.WHITE
        white_mobility = len(list(board.legal_moves))
        
        # Evaluate black piece activity
        board.turn = chess.BLACK
        black_mobility = len(list(board.legal_moves))
        
        # Restore turn
        board.turn = original_turn
        
        # Mobility bonus (each legal move is worth some centipawns)
        score += (white_mobility - black_mobility) * 5
        
        # Bonus for pieces on aggressive squares
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece is None:
                continue
            
            rank = chess.square_rank(square)
            bonus = 0
            
            # Pieces advanced into enemy territory get bonuses
            if piece.color == chess.WHITE and rank >= 4:
                bonus = self.AGGRESSIVE_POSITION_BONUS.get(piece.piece_type, 0) * (rank - 3)
            elif piece.color == chess.BLACK and rank <= 3:
                bonus = self.AGGRESSIVE_POSITION_BONUS.get(piece.piece_type, 0) * (4 - rank)
            
            if piece.color == chess.WHITE:
                score += bonus
            else:
                score -= bonus
        
        return score
    
    def _evaluate_center_control(self, board: chess.Board) -> float:
        """
        Evaluate center control for attacking potential.
        
        Center control enables piece coordination for attacks.
        """
        score = 0.0
        
        # Strong center control bonus
        for square in self.CENTER_SQUARES:
            piece = board.piece_at(square)
            if piece is not None:
                value = 30 if piece.color == chess.WHITE else -30
                score += value
            
            # Also count attackers of center
            white_control = len(board.attackers(chess.WHITE, square))
            black_control = len(board.attackers(chess.BLACK, square))
            score += (white_control - black_control) * 8
        
        # Extended center is also valuable
        for square in self.EXTENDED_CENTER:
            if square in self.CENTER_SQUARES:
                continue
            white_control = len(board.attackers(chess.WHITE, square))
            black_control = len(board.attackers(chess.BLACK, square))
            score += (white_control - black_control) * 4
        
        return score
    
    def _evaluate_threats(self, board: chess.Board) -> float:
        """
        Evaluate immediate threats and tactical opportunities.
        
        Aggressive players love having threats on the board.
        """
        score = 0.0
        
        # Check for capture opportunities (attacks on undefended pieces)
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece is None:
                continue
            
            attackers = board.attackers(not piece.color, square)
            defenders = board.attackers(piece.color, square)
            
            if len(attackers) > 0:
                # Piece is attacked
                if len(defenders) == 0:
                    # Hanging piece! Big bonus for us if we attack it
                    threat_value = self.PIECE_VALUES.get(piece.piece_type, 0) * 0.5
                    if piece.color == chess.WHITE:
                        score -= threat_value
                    else:
                        score += threat_value
                elif len(attackers) > len(defenders):
                    # We have more attackers than defenders
                    threat_value = self.PIECE_VALUES.get(piece.piece_type, 0) * 0.2
                    if piece.color == chess.WHITE:
                        score -= threat_value
                    else:
                        score += threat_value
        
        return score
    
    def get_best_move(self, board: chess.Board) -> Optional[chess.Move]:
        """
        Find the best move using minimax with alpha-beta pruning.
        
        The search is guided by the aggressive evaluation function,
        naturally preferring attacking moves and sacrifices that
        lead to strong attacking positions.
        
        Args:
            board: The current chess board position
            
        Returns:
            The best move found, or None if no legal moves exist
        """
        self.nodes_searched = 0
        
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            return None
        
        best_move = None
        best_score = float('-inf')
        alpha = float('-inf')
        beta = float('inf')
        
        # Order moves to improve alpha-beta efficiency
        # Aggressive ordering: captures and checks first
        ordered_moves = self._order_moves(board, legal_moves)
        
        for move in ordered_moves:
            board.push(move)
            self.nodes_searched += 1
            
            score = -self._minimax(board, self.search_depth - 1, -beta, -alpha)
            
            board.pop()
            
            if score > best_score:
                best_score = score
                best_move = move
            
            alpha = max(alpha, score)
        
        return best_move
    
    def _minimax(self, board: chess.Board, depth: int, alpha: float, beta: float) -> float:
        """
        Minimax search with alpha-beta pruning.
        
        Args:
            board: Current board position
            depth: Remaining search depth
            alpha: Alpha bound for pruning
            beta: Beta bound for pruning
            
        Returns:
            The evaluation score for the position
        """
        if depth == 0 or board.is_game_over():
            return self.evaluate_position(board)
        
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            return self.evaluate_position(board)
        
        # Order moves for better pruning
        ordered_moves = self._order_moves(board, legal_moves)
        
        best_score = float('-inf')
        
        for move in ordered_moves:
            board.push(move)
            self.nodes_searched += 1
            
            score = -self._minimax(board, depth - 1, -beta, -alpha)
            
            board.pop()
            
            best_score = max(best_score, score)
            alpha = max(alpha, score)
            
            if alpha >= beta:
                break  # Beta cutoff
        
        return best_score
    
    def _order_moves(self, board: chess.Board, moves: List[chess.Move]) -> List[chess.Move]:
        """
        Order moves for better alpha-beta pruning efficiency.
        
        Aggressive ordering prioritizes:
        1. Captures (especially winning captures)
        2. Checks
        3. Attacks on high-value pieces
        4. Central moves
        """
        def move_score(move: chess.Move) -> int:
            score = 0
            
            # Captures are highly valued
            if board.is_capture(move):
                captured = board.piece_at(move.to_square)
                attacker = board.piece_at(move.from_square)
                if captured and attacker:
                    # MVV-LVA: Most Valuable Victim - Least Valuable Attacker
                    score += 10000 + self.PIECE_VALUES.get(captured.piece_type, 0) - self.PIECE_VALUES.get(attacker.piece_type, 0) // 10
            
            # Checks are very aggressive
            board.push(move)
            if board.is_check():
                score += 5000
            board.pop()
            
            # Promotions
            if move.promotion:
                score += 8000 + self.PIECE_VALUES.get(move.promotion, 0)
            
            # Central moves
            if move.to_square in self.CENTER_SQUARES:
                score += 100
            elif move.to_square in self.EXTENDED_CENTER:
                score += 50
            
            # Advancing pieces is aggressive
            piece = board.piece_at(move.from_square)
            if piece:
                to_rank = chess.square_rank(move.to_square)
                from_rank = chess.square_rank(move.from_square)
                if piece.color == chess.WHITE:
                    score += (to_rank - from_rank) * 20
                else:
                    score += (from_rank - to_rank) * 20
            
            return score
        
        return sorted(moves, key=move_score, reverse=True)
    
    def play_turn(self, board: chess.Board) -> Optional[chess.Move]:
        """
        Execute a turn and return the move made.
        
        This method finds the best move according to the aggressive
        strategy and applies it to the board.
        
        Args:
            board: The current chess board (will be modified)
            
        Returns:
            The move that was played, or None if no legal moves
        """
        move = self.get_best_move(board)
        
        if move is not None:
            # Announce aggressive moves with flair
            is_capture = board.is_capture(move)
            board.push(move)
            is_check = board.is_check()
            
            move_description = board.san(board.pop())
            board.push(move)
            
            if is_capture and is_check:
                print(f"{self.name} strikes with {move_description}! (Capture + Check)")
            elif is_capture:
                print(f"{self.name} captures: {move_description}")
            elif is_check:
                print(f"{self.name} delivers check: {move_description}")
            else:
                print(f"{self.name} plays: {move_description}")
            
            print(f"  (Searched {self.nodes_searched} positions)")
        
        return move


def demonstrate_aggressive_play():
    """
    Demonstrate the aggressive chess player in action.
    
    This creates a board and shows the aggressive player making
    several moves, highlighting its attacking style.
    """
    print("=" * 60)
    print("AGGRESSIVE CHESS PLAYER DEMONSTRATION")
    print("=" * 60)
    print()
    
    # Create player and board
    player = AggressiveChessPlayer(name="The Aggressor", search_depth=3)
    board = chess.Board()
    
    print("Starting position:")
    print(board)
    print()
    
    # Play several moves to show aggressive style
    print("Watch the aggressive player in action:\n")
    
    for i in range(6):
        if board.is_game_over():
            break
        
        print(f"Move {i + 1} ({'White' if board.turn == chess.WHITE else 'Black'}):")
        
        move = player.play_turn(board)
        if move is None:
            print("No legal moves!")
            break
        
        print(f"Position evaluation: {player.evaluate_position(board):.0f} centipawns")
        print()
        print(board)
        print()
        print("-" * 40)
        print()
    
    # Show a tactical position where aggression shines
    print("\n" + "=" * 60)
    print("TACTICAL POSITION TEST")
    print("=" * 60)
    print()
    
    # Italian Game position with tactical opportunities
    tactical_board = chess.Board("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4")
    print("Position (Scholar's Mate threat):")
    print(tactical_board)
    print()
    
    tactical_player = AggressiveChessPlayer(name="Tactical Aggressor", search_depth=4)
    print("Finding aggressive continuation...")
    move = tactical_player.get_best_move(tactical_board)
    
    if move:
        print(f"Best move found: {tactical_board.san(move)}")
        print(f"Nodes searched: {tactical_player.nodes_searched}")
        
        tactical_board.push(move)
        print(f"Evaluation after move: {tactical_player.evaluate_position(tactical_board):.0f}")
        print()
        print(tactical_board)


if __name__ == "__main__":
    demonstrate_aggressive_play()
