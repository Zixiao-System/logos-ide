//! Position and Range types for text locations

use serde::{Deserialize, Serialize};

/// A position in a text document (0-indexed)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Position {
    /// Line number (0-indexed)
    pub line: u32,
    /// Column number (0-indexed, UTF-16 code units)
    pub column: u32,
}

impl Position {
    pub fn new(line: u32, column: u32) -> Self {
        Self { line, column }
    }

    pub fn zero() -> Self {
        Self { line: 0, column: 0 }
    }
}

impl Default for Position {
    fn default() -> Self {
        Self::zero()
    }
}

impl PartialOrd for Position {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Position {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        match self.line.cmp(&other.line) {
            std::cmp::Ordering::Equal => self.column.cmp(&other.column),
            ord => ord,
        }
    }
}

/// A range in a text document
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Range {
    /// Start position (inclusive)
    pub start: Position,
    /// End position (exclusive)
    pub end: Position,
}

impl Range {
    pub fn new(start: Position, end: Position) -> Self {
        Self { start, end }
    }

    pub fn from_coords(start_line: u32, start_col: u32, end_line: u32, end_col: u32) -> Self {
        Self {
            start: Position::new(start_line, start_col),
            end: Position::new(end_line, end_col),
        }
    }

    pub fn point(line: u32, column: u32) -> Self {
        let pos = Position::new(line, column);
        Self {
            start: pos,
            end: pos,
        }
    }

    /// Check if this range contains the given position
    pub fn contains(&self, pos: Position) -> bool {
        self.start <= pos && pos < self.end
    }

    /// Check if this range overlaps with another range
    pub fn overlaps(&self, other: &Range) -> bool {
        self.start < other.end && other.start < self.end
    }

    /// Check if this range is empty
    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }
}

impl Default for Range {
    fn default() -> Self {
        Self {
            start: Position::zero(),
            end: Position::zero(),
        }
    }
}

/// A location in a document (URI + Range)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Location {
    pub uri: String,
    pub range: Range,
}

impl Location {
    pub fn new(uri: String, range: Range) -> Self {
        Self { uri, range }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position_ordering() {
        let p1 = Position::new(0, 0);
        let p2 = Position::new(0, 5);
        let p3 = Position::new(1, 0);

        assert!(p1 < p2);
        assert!(p2 < p3);
        assert!(p1 < p3);
    }

    #[test]
    fn test_range_contains() {
        let range = Range::from_coords(1, 0, 1, 10);
        assert!(range.contains(Position::new(1, 5)));
        assert!(!range.contains(Position::new(1, 10)));
        assert!(!range.contains(Position::new(0, 5)));
    }
}