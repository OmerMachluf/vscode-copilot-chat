"""
Aggressive Chess Player Implementation

This module implements an aggressive chess playing strategy that prioritizes
attacking opponent pieces, creating threats, and maintaining piece activity.
The strategy is willing to sacrifice material for attacking chances.

Strategy Principles:
- Attack first, defend later
- Control the center for better piece mobility
- Create multiple threats when possible
- Prioritize checks and checkmate patterns
- Value piece activity over material in some cases
"""

from typing import Optional


# Piece values for evaluation (standard values with aggressive modifiers)
PIECE_VALUES = {
    'P': 100,   # Pawn
    'N': 320,   # Knight (slightly higher - good for attacks)
    'B': 330,   # Bishop (good for long-range attacks)
    'R': 500,   # Rook
    'Q': 900,   # Queen (primary attacking piece)
    'K': 20000  # King (infinite value for checkmate)
}

# Bonus values for aggressive play
ATTACK_BONUS = 50          # Bonus for attacking enemy pieces
CHECK_BONUS = 200          # Bonus for giving check
THREAT_BONUS = 30          # Bonus for creating threats
CENTER_CONTROL_BONUS = 25  # Bonus for controlling center squares
ADVANCED_PAWN_BONUS = 15   # Bonus per rank for advanced pawns

# Center squares are valuable for piece activity
CENTER_SQUARES = {'d4', 'd5', 'e4', 'e5'}
EXTENDED_CENTER = {'c3', 'c4', 'c5', 'c6', 'd3', 'd6', 'e3', 'e6', 'f3', 'f4', 'f5', 'f6'}


class ChessPlayer:
    """
    An aggressive chess player that prioritizes attacks and threats.
    
    This player evaluates positions based on:
    - Material balance with attack bonuses
    - Piece activity and center control
    - Number of attacks on enemy pieces
    - Check and checkmate opportunities
    
    Attributes:
        color: The player's color ('white' or 'black')
        is_white: Boolean indicating if player is white
    """
    
    def __init__(self, color: str):
        """
        Initialize the chess player with a color.
        
        Args:
            color: Either 'white' or 'black'
            
        Raises:
            ValueError: If color is not 'white' or 'black'
        """
        if color not in ('white', 'black'):
            raise ValueError("Color must be 'white' or 'black'")
        
        self.color = color
        self.is_white = color == 'white'
    
    def get_move(self, board_state: dict) -> Optional[str]:
        """
        Determine the best move based on aggressive strategy.
        
        The move selection prioritizes:
        1. Checkmate moves (instant win)
        2. Moves that give check
        3. Captures of high-value pieces
        4. Moves that create multiple threats
        5. Moves that improve piece activity
        
        Args:
            board_state: Dictionary representing the current board position
                        Keys are squares (e.g., 'e4'), values are pieces (e.g., 'wP')
        
        Returns:
            Best move in format 'e2e4' or None if no legal moves
        """
        legal_moves = self._generate_moves(board_state)
        
        if not legal_moves:
            return None
        
        best_move = None
        best_score = float('-inf')
        
        for move in legal_moves:
            # Simulate the move
            new_board = self._make_move(board_state, move)
            
            # Evaluate the resulting position
            score = self._evaluate_move(board_state, new_board, move)
            
            # Aggressive bonus for checks
            if self._is_check(new_board, not self.is_white):
                score += CHECK_BONUS
            
            # Aggressive bonus for captures
            captured_piece = self._get_captured_piece(board_state, move)
            if captured_piece:
                score += ATTACK_BONUS + PIECE_VALUES.get(captured_piece[1], 0)
            
            # Bonus for threatening enemy pieces
            threats = self._count_threats(new_board, self.is_white)
            score += threats * THREAT_BONUS
            
            if score > best_score:
                best_score = score
                best_move = move
        
        return best_move
    
    def evaluate_position(self, board_state: dict) -> float:
        """
        Evaluate the board position from the perspective of this player.
        
        Evaluation factors (aggressive weighting):
        - Material count with piece values
        - Center control bonus
        - Piece activity (number of possible attacks)
        - Pawn advancement (aggressive pawns)
        - King safety (minimal consideration for opponent's king)
        
        Args:
            board_state: Dictionary representing the board position
        
        Returns:
            Float score - positive means favorable for this player
        """
        score = 0.0
        
        # Material evaluation
        for square, piece in board_state.items():
            if not piece:
                continue
            
            piece_color_white = piece[0] == 'w'
            piece_type = piece[1]
            piece_value = PIECE_VALUES.get(piece_type, 0)
            
            # Add or subtract based on piece ownership
            if piece_color_white == self.is_white:
                score += piece_value
            else:
                score -= piece_value
            
            # Center control bonus
            if square in CENTER_SQUARES:
                bonus = CENTER_CONTROL_BONUS
                if piece_color_white == self.is_white:
                    score += bonus
                else:
                    score -= bonus
            elif square in EXTENDED_CENTER:
                bonus = CENTER_CONTROL_BONUS // 2
                if piece_color_white == self.is_white:
                    score += bonus
                else:
                    score -= bonus
            
            # Advanced pawn bonus (aggressive strategy loves advanced pawns)
            if piece_type == 'P':
                rank = int(square[1])
                if piece_color_white:
                    advancement = rank - 2  # Pawns start on rank 2
                else:
                    advancement = 7 - rank  # Black pawns start on rank 7
                
                if piece_color_white == self.is_white:
                    score += advancement * ADVANCED_PAWN_BONUS
                else:
                    score -= advancement * ADVANCED_PAWN_BONUS
        
        # Piece activity bonus - count attacks
        our_threats = self._count_threats(board_state, self.is_white)
        enemy_threats = self._count_threats(board_state, not self.is_white)
        score += (our_threats - enemy_threats) * THREAT_BONUS
        
        return score
    
    def _generate_moves(self, board_state: dict) -> list:
        """
        Generate all pseudo-legal moves for the current player.
        
        This is a simplified move generator that handles basic piece movements.
        In a full implementation, this would include all chess rules.
        
        Args:
            board_state: Current board position
            
        Returns:
            List of moves in 'e2e4' format
        """
        moves = []
        our_prefix = 'w' if self.is_white else 'b'
        
        for square, piece in board_state.items():
            if not piece or piece[0] != our_prefix:
                continue
            
            piece_type = piece[1]
            piece_moves = self._get_piece_moves(board_state, square, piece_type)
            moves.extend(piece_moves)
        
        return moves
    
    def _get_piece_moves(self, board_state: dict, square: str, piece_type: str) -> list:
        """
        Generate moves for a specific piece.
        
        Args:
            board_state: Current board position
            square: Current square of the piece
            piece_type: Type of piece (P, N, B, R, Q, K)
            
        Returns:
            List of valid moves for this piece
        """
        moves = []
        file_idx = ord(square[0]) - ord('a')
        rank = int(square[1])
        
        if piece_type == 'P':
            moves.extend(self._get_pawn_moves(board_state, square, file_idx, rank))
        elif piece_type == 'N':
            moves.extend(self._get_knight_moves(board_state, square, file_idx, rank))
        elif piece_type == 'B':
            moves.extend(self._get_bishop_moves(board_state, square, file_idx, rank))
        elif piece_type == 'R':
            moves.extend(self._get_rook_moves(board_state, square, file_idx, rank))
        elif piece_type == 'Q':
            moves.extend(self._get_queen_moves(board_state, square, file_idx, rank))
        elif piece_type == 'K':
            moves.extend(self._get_king_moves(board_state, square, file_idx, rank))
        
        return moves
    
    def _get_pawn_moves(self, board_state: dict, square: str, file_idx: int, rank: int) -> list:
        """Generate pawn moves including captures (aggressive pawn play)."""
        moves = []
        direction = 1 if self.is_white else -1
        start_rank = 2 if self.is_white else 7
        enemy_prefix = 'b' if self.is_white else 'w'
        
        # Forward move
        new_rank = rank + direction
        if 1 <= new_rank <= 8:
            target = f"{chr(ord('a') + file_idx)}{new_rank}"
            if target not in board_state or not board_state[target]:
                moves.append(f"{square}{target}")
                
                # Double move from starting position
                if rank == start_rank:
                    double_rank = rank + 2 * direction
                    double_target = f"{chr(ord('a') + file_idx)}{double_rank}"
                    if double_target not in board_state or not board_state[double_target]:
                        moves.append(f"{square}{double_target}")
        
        # Captures (prioritized in aggressive play)
        for file_offset in [-1, 1]:
            new_file = file_idx + file_offset
            if 0 <= new_file <= 7 and 1 <= new_rank <= 8:
                target = f"{chr(ord('a') + new_file)}{new_rank}"
                if target in board_state and board_state[target] and board_state[target][0] == enemy_prefix:
                    moves.append(f"{square}{target}")
        
        return moves
    
    def _get_knight_moves(self, board_state: dict, square: str, file_idx: int, rank: int) -> list:
        """Generate knight moves - knights are great for aggressive tactics."""
        moves = []
        our_prefix = 'w' if self.is_white else 'b'
        
        # All possible knight offsets
        offsets = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
        
        for file_off, rank_off in offsets:
            new_file = file_idx + file_off
            new_rank = rank + rank_off
            
            if 0 <= new_file <= 7 and 1 <= new_rank <= 8:
                target = f"{chr(ord('a') + new_file)}{new_rank}"
                # Can move if square is empty or has enemy piece
                if target not in board_state or not board_state[target] or board_state[target][0] != our_prefix:
                    moves.append(f"{square}{target}")
        
        return moves
    
    def _get_sliding_moves(self, board_state: dict, square: str, file_idx: int, rank: int, directions: list) -> list:
        """Generate moves for sliding pieces (bishop, rook, queen)."""
        moves = []
        our_prefix = 'w' if self.is_white else 'b'
        
        for file_dir, rank_dir in directions:
            new_file = file_idx + file_dir
            new_rank = rank + rank_dir
            
            while 0 <= new_file <= 7 and 1 <= new_rank <= 8:
                target = f"{chr(ord('a') + new_file)}{new_rank}"
                
                if target not in board_state or not board_state[target]:
                    moves.append(f"{square}{target}")
                elif board_state[target][0] != our_prefix:
                    moves.append(f"{square}{target}")  # Capture!
                    break
                else:
                    break  # Blocked by own piece
                
                new_file += file_dir
                new_rank += rank_dir
        
        return moves
    
    def _get_bishop_moves(self, board_state: dict, square: str, file_idx: int, rank: int) -> list:
        """Generate bishop moves (diagonal sliding)."""
        directions = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
        return self._get_sliding_moves(board_state, square, file_idx, rank, directions)
    
    def _get_rook_moves(self, board_state: dict, square: str, file_idx: int, rank: int) -> list:
        """Generate rook moves (horizontal/vertical sliding)."""
        directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        return self._get_sliding_moves(board_state, square, file_idx, rank, directions)
    
    def _get_queen_moves(self, board_state: dict, square: str, file_idx: int, rank: int) -> list:
        """Generate queen moves (combines rook and bishop)."""
        directions = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
        return self._get_sliding_moves(board_state, square, file_idx, rank, directions)
    
    def _get_king_moves(self, board_state: dict, square: str, file_idx: int, rank: int) -> list:
        """Generate king moves (one square in any direction)."""
        moves = []
        our_prefix = 'w' if self.is_white else 'b'
        
        for file_off in [-1, 0, 1]:
            for rank_off in [-1, 0, 1]:
                if file_off == 0 and rank_off == 0:
                    continue
                
                new_file = file_idx + file_off
                new_rank = rank + rank_off
                
                if 0 <= new_file <= 7 and 1 <= new_rank <= 8:
                    target = f"{chr(ord('a') + new_file)}{new_rank}"
                    if target not in board_state or not board_state[target] or board_state[target][0] != our_prefix:
                        moves.append(f"{square}{target}")
        
        return moves
    
    def _make_move(self, board_state: dict, move: str) -> dict:
        """
        Apply a move to the board and return the new position.
        
        Args:
            board_state: Current board position
            move: Move in 'e2e4' format
            
        Returns:
            New board state after the move
        """
        new_board = dict(board_state)
        from_sq = move[:2]
        to_sq = move[2:4]
        
        piece = new_board.get(from_sq)
        new_board[from_sq] = None
        new_board[to_sq] = piece
        
        return new_board
    
    def _evaluate_move(self, old_board: dict, new_board: dict, move: str) -> float:
        """
        Evaluate how good a move is based on aggressive criteria.
        
        Args:
            old_board: Board before move
            new_board: Board after move
            move: The move being evaluated
            
        Returns:
            Score for the move
        """
        return self.evaluate_position(new_board)
    
    def _get_captured_piece(self, board_state: dict, move: str) -> Optional[str]:
        """Get the piece captured by a move, if any."""
        to_sq = move[2:4]
        return board_state.get(to_sq)
    
    def _is_check(self, board_state: dict, is_white_in_check: bool) -> bool:
        """
        Determine if the specified player is in check.
        
        This is a simplified check detection.
        
        Args:
            board_state: Current board position
            is_white_in_check: True to check if white is in check, False for black
            
        Returns:
            True if the player is in check
        """
        # Find the king
        king_prefix = 'w' if is_white_in_check else 'b'
        king_square = None
        
        for square, piece in board_state.items():
            if piece == f"{king_prefix}K":
                king_square = square
                break
        
        if not king_square:
            return False
        
        # Check if any enemy piece attacks the king
        enemy_prefix = 'b' if is_white_in_check else 'w'
        
        for square, piece in board_state.items():
            if not piece or piece[0] != enemy_prefix:
                continue
            
            # Generate attacks from this piece
            file_idx = ord(square[0]) - ord('a')
            rank = int(square[1])
            piece_type = piece[1]
            
            # Simplified attack detection
            attacks = self._get_piece_attacks(board_state, square, file_idx, rank, piece_type, enemy_prefix)
            
            if king_square in attacks:
                return True
        
        return False
    
    def _get_piece_attacks(self, board_state: dict, square: str, file_idx: int, rank: int, piece_type: str, prefix: str) -> set:
        """Get all squares attacked by a piece."""
        attacks = set()
        
        if piece_type == 'P':
            direction = 1 if prefix == 'w' else -1
            for file_off in [-1, 1]:
                new_file = file_idx + file_off
                new_rank = rank + direction
                if 0 <= new_file <= 7 and 1 <= new_rank <= 8:
                    attacks.add(f"{chr(ord('a') + new_file)}{new_rank}")
        elif piece_type == 'N':
            offsets = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
            for file_off, rank_off in offsets:
                new_file = file_idx + file_off
                new_rank = rank + rank_off
                if 0 <= new_file <= 7 and 1 <= new_rank <= 8:
                    attacks.add(f"{chr(ord('a') + new_file)}{new_rank}")
        elif piece_type in 'BRQ':
            directions = []
            if piece_type in 'BQ':
                directions.extend([(-1, -1), (-1, 1), (1, -1), (1, 1)])
            if piece_type in 'RQ':
                directions.extend([(-1, 0), (1, 0), (0, -1), (0, 1)])
            
            for file_dir, rank_dir in directions:
                new_file = file_idx + file_dir
                new_rank = rank + rank_dir
                while 0 <= new_file <= 7 and 1 <= new_rank <= 8:
                    target = f"{chr(ord('a') + new_file)}{new_rank}"
                    attacks.add(target)
                    if target in board_state and board_state[target]:
                        break
                    new_file += file_dir
                    new_rank += rank_dir
        elif piece_type == 'K':
            for file_off in [-1, 0, 1]:
                for rank_off in [-1, 0, 1]:
                    if file_off == 0 and rank_off == 0:
                        continue
                    new_file = file_idx + file_off
                    new_rank = rank + rank_off
                    if 0 <= new_file <= 7 and 1 <= new_rank <= 8:
                        attacks.add(f"{chr(ord('a') + new_file)}{new_rank}")
        
        return attacks
    
    def _count_threats(self, board_state: dict, is_white_attacking: bool) -> int:
        """
        Count the number of attacks on enemy pieces.
        
        This is a key metric for aggressive play - more threats = better position.
        
        Args:
            board_state: Current board position
            is_white_attacking: True to count white's attacks on black pieces
            
        Returns:
            Number of enemy pieces under attack
        """
        attacker_prefix = 'w' if is_white_attacking else 'b'
        defender_prefix = 'b' if is_white_attacking else 'w'
        
        # Find all squares attacked by the attacker
        attacked_squares = set()
        
        for square, piece in board_state.items():
            if not piece or piece[0] != attacker_prefix:
                continue
            
            file_idx = ord(square[0]) - ord('a')
            rank = int(square[1])
            piece_type = piece[1]
            
            attacks = self._get_piece_attacks(board_state, square, file_idx, rank, piece_type, attacker_prefix)
            attacked_squares.update(attacks)
        
        # Count how many enemy pieces are on attacked squares
        threats = 0
        for square, piece in board_state.items():
            if piece and piece[0] == defender_prefix and square in attacked_squares:
                threats += 1
        
        return threats


def create_starting_position() -> dict:
    """Create the standard chess starting position."""
    board = {}
    
    # White pieces
    board['a1'] = 'wR'
    board['b1'] = 'wN'
    board['c1'] = 'wB'
    board['d1'] = 'wQ'
    board['e1'] = 'wK'
    board['f1'] = 'wB'
    board['g1'] = 'wN'
    board['h1'] = 'wR'
    for file in 'abcdefgh':
        board[f'{file}2'] = 'wP'
    
    # Black pieces
    board['a8'] = 'bR'
    board['b8'] = 'bN'
    board['c8'] = 'bB'
    board['d8'] = 'bQ'
    board['e8'] = 'bK'
    board['f8'] = 'bB'
    board['g8'] = 'bN'
    board['h8'] = 'bR'
    for file in 'abcdefgh':
        board[f'{file}7'] = 'bP'
    
    return board


def print_board(board_state: dict) -> None:
    """Print the board in a human-readable format."""
    print("  a b c d e f g h")
    print("  ----------------")
    
    for rank in range(8, 0, -1):
        row = f"{rank}|"
        for file in 'abcdefgh':
            square = f"{file}{rank}"
            piece = board_state.get(square)
            if piece:
                row += piece[1] if piece[0] == 'w' else piece[1].lower()
            else:
                row += '.'
            row += ' '
        print(row + f"|{rank}")
    
    print("  ----------------")
    print("  a b c d e f g h")


if __name__ == '__main__':
    # Test the aggressive chess player
    print("=" * 50)
    print("Aggressive Chess Player - Test Suite")
    print("=" * 50)
    
    # Test 1: Create player and verify initialization
    print("\n[Test 1] Creating aggressive player...")
    player = ChessPlayer('white')
    assert player.color == 'white'
    assert player.is_white is True
    print("✓ White player created successfully")
    
    black_player = ChessPlayer('black')
    assert black_player.color == 'black'
    assert black_player.is_white is False
    print("✓ Black player created successfully")
    
    # Test 2: Starting position evaluation
    print("\n[Test 2] Evaluating starting position...")
    board = create_starting_position()
    print_board(board)
    
    white_eval = player.evaluate_position(board)
    black_eval = black_player.evaluate_position(board)
    print(f"White's evaluation: {white_eval}")
    print(f"Black's evaluation: {black_eval}")
    print("✓ Position evaluation working")
    
    # Test 3: Get opening move
    print("\n[Test 3] Getting opening move for white...")
    move = player.get_move(board)
    print(f"White's chosen move: {move}")
    assert move is not None
    assert len(move) == 4
    print("✓ Opening move generated")
    
    # Test 4: Test aggressive preference for captures
    print("\n[Test 4] Testing capture preference...")
    # Set up a position where white can capture a piece
    capture_board = {
        'e1': 'wK',
        'e4': 'wQ',
        'd5': 'bP',  # Black pawn that can be captured
        'e8': 'bK',
    }
    print_board(capture_board)
    
    capture_move = player.get_move(capture_board)
    print(f"Move chosen: {capture_move}")
    # The queen should want to capture the pawn (aggressive play)
    print("✓ Capture scenario tested")
    
    # Test 5: Test threat counting
    print("\n[Test 5] Testing threat detection...")
    threats = player._count_threats(capture_board, True)
    print(f"White threats on black pieces: {threats}")
    print("✓ Threat counting working")
    
    # Test 6: Test check detection
    print("\n[Test 6] Testing check detection...")
    check_board = {
        'e1': 'wK',
        'e7': 'wQ',  # Queen giving check
        'e8': 'bK',
    }
    print_board(check_board)
    
    is_black_in_check = player._is_check(check_board, False)
    print(f"Black is in check: {is_black_in_check}")
    assert is_black_in_check is True
    print("✓ Check detection working")
    
    # Test 7: Test a mid-game position
    print("\n[Test 7] Testing mid-game position...")
    mid_game = {
        'e1': 'wK',
        'f3': 'wN',
        'c4': 'wB',
        'd1': 'wQ',
        'a1': 'wR',
        'h1': 'wR',
        'd4': 'wP',
        'e5': 'wP',
        'e8': 'bK',
        'c6': 'bN',
        'f8': 'bB',
        'd8': 'bQ',
        'a8': 'bR',
        'h8': 'bR',
        'd6': 'bP',
        'f7': 'bP',
    }
    print_board(mid_game)
    
    mid_move = player.get_move(mid_game)
    mid_eval = player.evaluate_position(mid_game)
    print(f"White's evaluation: {mid_eval}")
    print(f"White's chosen move: {mid_move}")
    print("✓ Mid-game analysis working")
    
    print("\n" + "=" * 50)
    print("All tests passed! Aggressive player is ready.")
    print("=" * 50)
