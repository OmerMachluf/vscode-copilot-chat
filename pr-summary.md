# Add Symbol Navigation Tools: Definitions, Document Symbols, Implementations, and References

## Summary
Adds four comprehensive language service navigation tools to enable precise, LSP-backed code navigation: `get_definitions`, `document_symbols`, `find_implementations`, and `find_references`. These tools leverage VS Code's language services for accurate symbol-based navigation throughout the codebase.

## New Tools Added

### 1. `get_definitions` Tool (Go to Definition)
- Locates the declaration/definition of a symbol from its usage point
- Handles both single definitions and multiple declarations (e.g., partial classes, overloads)
- Essential for jumping from usage to the actual definition
- Returns file path, line, and column for each definition location

### 2. `document_symbols` Tool (File Structure Overview)
- Lists all symbols (classes, methods, properties, functions, etc.) in a file with hierarchical structure
- **Pagination support**: handles large files with configurable page size (default 40, max 200)
- **Caching**: caches symbols per document version to avoid redundant LSP calls
- Returns flattened symbol tree with depth, kind, detail, range, and location information
- Useful for getting a structural overview before diving into specific symbols

### 3. `find_implementations` Tool (Go to Implementations)
- Locates concrete implementations of interfaces, abstract members, or virtual methods
- Critical for understanding where abstract contracts are actually realized
- Returns all implementation locations across the workspace

### 4. `find_references` Tool (Find All References)
- Finds all references/usages of a symbol across the workspace
- De-duplicates and sorts results by file path and position for clarity
- Essential for impact analysis and understanding symbol usage patterns
- Helps determine safe refactoring scope

## Core Infrastructure

### Symbol Position Normalization (`toolUtils.ts`)
Added robust symbol resolution logic shared across all navigation tools:

- **`normalizeSymbolPosition()`**: Converts user input (line + symbol name) to precise LSP position
  - Uses document symbols for accurate positioning vs. naive text search
  - Supports `symbolId` for disambiguating multiple symbols on same line
  - Falls back to text search for backward compatibility

- **`SymbolAmbiguityError`**: Custom error type for handling multiple matching symbols
  - Returns candidate list with `symbolId`, `kind`, `name`, and `column`
  - Allows caller to retry with specific `symbolId` or refined `expectedKind`

- **Symbol kind matching**: Maps common type aliases (e.g., "type" matches "class"/"interface"/"enum")

- **Validation**: Line range validation, finite number checks, symbol name validation

### Tool Registration Logging
Added diagnostic logging to track tool registration during extension activation for debugging purposes.

## Common Tool Pattern

All four navigation tools follow a consistent design:

1. **Input validation**: File path resolution and accessibility checks
2. **Symbol normalization**: Convert line + symbol name to precise position
3. **Ambiguity handling**: Graceful error with candidate suggestions if multiple symbols match
4. **LSP invocation**: Call appropriate language service (definitions/implementations/references)
5. **Result formatting**: Structured TSX output with file widgets and location references
6. **User feedback**: Both detailed TSX results and concise markdown summaries

## Design Decisions

1. **Shared symbol resolution**: All navigation tools use the same `normalizeSymbolPosition()` logic for consistency
2. **Ambiguity handling**: Gracefully handles multiple symbols on same line by returning candidates
3. **Zero-based vs 1-based**: Tools accept 1-based line numbers (user-friendly) but convert internally
4. **Pagination for symbols**: Document symbols tool uses pagination to handle large files without overwhelming context
5. **Location de-duplication**: References tool removes duplicate locations and sorts for clarity
6. **LSP-first approach**: Leverages VS Code's language services for accuracy over heuristic text searches
7. **Localization**: All user-facing messages use `l10n.t()` for multi-language support

## Use Cases Enabled

- **Code exploration**: Start with `document_symbols` to understand file structure
- **Definition lookup**: Use `get_definitions` to find where a symbol is declared
- **Implementation discovery**: Use `find_implementations` to find concrete realizations of interfaces/abstracts
- **Usage analysis**: Use `find_references` to understand where/how a symbol is used
- **Refactoring assistance**: Combine references + implementations to assess change impact

## Testing Considerations
- Symbol resolution with multiple symbols on same line
- Pagination edge cases (empty files, single page, boundary conditions)
- Reference de-duplication across different ranges
- Symbol kind aliasing (e.g., "Type" matching "Class")
- Error handling for out-of-bounds lines and invalid symbol names
- Ambiguity error response format and candidate selection
