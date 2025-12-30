//! Document management with incremental updates

use crate::position::{Position, Range};
use serde::{Deserialize, Serialize};

/// A text document managed by the language service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    /// Document URI (unique identifier)
    pub uri: String,
    /// Document version (incremented on each change)
    pub version: u32,
    /// Language identifier (e.g., "python", "rust")
    pub language_id: String,
    /// Document content
    content: String,
    /// Line start offsets (byte offsets)
    line_offsets: Vec<usize>,
}

impl Document {
    pub fn new(uri: String, language_id: String, content: String) -> Self {
        let line_offsets = Self::compute_line_offsets(&content);
        Self {
            uri,
            version: 0,
            language_id,
            content,
            line_offsets,
        }
    }

    /// Get the full content of the document
    pub fn content(&self) -> &str {
        &self.content
    }

    /// Get the number of lines in the document
    pub fn line_count(&self) -> u32 {
        self.line_offsets.len() as u32
    }

    /// Get a specific line (without trailing newline)
    pub fn line(&self, line_number: u32) -> Option<&str> {
        let line_idx = line_number as usize;
        if line_idx >= self.line_offsets.len() {
            return None;
        }

        let start = self.line_offsets[line_idx];
        let end = if line_idx + 1 < self.line_offsets.len() {
            // Remove trailing newline
            let next_start = self.line_offsets[line_idx + 1];
            if next_start > 0 && self.content.as_bytes().get(next_start - 1) == Some(&b'\n') {
                next_start - 1
            } else {
                next_start
            }
        } else {
            self.content.len()
        };

        Some(&self.content[start..end])
    }

    /// Convert a position to a byte offset
    pub fn offset_at(&self, position: Position) -> Option<usize> {
        let line_idx = position.line as usize;
        if line_idx >= self.line_offsets.len() {
            return None;
        }

        let line_start = self.line_offsets[line_idx];
        let line_end = if line_idx + 1 < self.line_offsets.len() {
            self.line_offsets[line_idx + 1]
        } else {
            self.content.len()
        };

        // Convert column (UTF-16 code units) to byte offset
        let line_content = &self.content[line_start..line_end];
        let mut col = 0u32;
        let mut byte_offset = 0;

        for ch in line_content.chars() {
            if col >= position.column {
                break;
            }
            col += ch.len_utf16() as u32;
            byte_offset += ch.len_utf8();
        }

        Some(line_start + byte_offset)
    }

    /// Convert a byte offset to a position
    pub fn position_at(&self, offset: usize) -> Position {
        let offset = offset.min(self.content.len());

        // Binary search for the line
        let line = match self.line_offsets.binary_search(&offset) {
            Ok(line) => line,
            Err(line) => line.saturating_sub(1),
        };

        let line_start = self.line_offsets[line];
        let line_content = &self.content[line_start..offset];

        // Count UTF-16 code units for column
        let column: u32 = line_content.chars().map(|c| c.len_utf16() as u32).sum();

        Position::new(line as u32, column)
    }

    /// Apply a full content change
    pub fn set_content(&mut self, content: String) {
        self.content = content;
        self.line_offsets = Self::compute_line_offsets(&self.content);
        self.version += 1;
    }

    /// Apply an incremental change
    pub fn apply_change(&mut self, range: Range, text: &str) {
        let start_offset = self.offset_at(range.start).unwrap_or(0);
        let end_offset = self.offset_at(range.end).unwrap_or(self.content.len());

        let mut new_content = String::with_capacity(
            self.content.len() - (end_offset - start_offset) + text.len(),
        );
        new_content.push_str(&self.content[..start_offset]);
        new_content.push_str(text);
        new_content.push_str(&self.content[end_offset..]);

        self.content = new_content;
        self.line_offsets = Self::compute_line_offsets(&self.content);
        self.version += 1;
    }

    /// Get text in a range
    pub fn text_in_range(&self, range: Range) -> Option<&str> {
        let start = self.offset_at(range.start)?;
        let end = self.offset_at(range.end)?;
        Some(&self.content[start..end])
    }

    /// Compute line start offsets
    fn compute_line_offsets(content: &str) -> Vec<usize> {
        let mut offsets = vec![0];
        for (i, ch) in content.char_indices() {
            if ch == '\n' {
                offsets.push(i + 1);
            }
        }
        offsets
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_document_lines() {
        let doc = Document::new(
            "test.py".to_string(),
            "python".to_string(),
            "line1\nline2\nline3".to_string(),
        );

        assert_eq!(doc.line_count(), 3);
        assert_eq!(doc.line(0), Some("line1"));
        assert_eq!(doc.line(1), Some("line2"));
        assert_eq!(doc.line(2), Some("line3"));
    }

    #[test]
    fn test_position_offset_roundtrip() {
        let doc = Document::new(
            "test.py".to_string(),
            "python".to_string(),
            "hello\nworld\n".to_string(),
        );

        let pos = Position::new(1, 3);
        let offset = doc.offset_at(pos).unwrap();
        let pos2 = doc.position_at(offset);
        assert_eq!(pos, pos2);
    }

    #[test]
    fn test_apply_change() {
        let mut doc = Document::new(
            "test.py".to_string(),
            "python".to_string(),
            "hello world".to_string(),
        );

        doc.apply_change(Range::from_coords(0, 6, 0, 11), "rust");
        assert_eq!(doc.content(), "hello rust");
    }
}