//! Logos Parser - Tree-sitter based parsing for multiple languages

pub mod python;
pub mod go;
pub mod rust_lang;
pub mod c;
pub mod cpp;
pub mod java;
pub mod javascript;
pub mod typescript;

use logos_core::{Diagnostic, Position, Range};
use thiserror::Error;
use tree_sitter::{Parser, Tree, Node, Language};

/// Parser errors
#[derive(Debug, Error)]
pub enum ParseError {
    #[error("Failed to set language: {0}")]
    LanguageError(String),
    #[error("Parse failed")]
    ParseFailed,
    #[error("Unsupported language: {0}")]
    UnsupportedLanguage(String),
}

/// Supported programming languages
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LanguageId {
    Python,
    Go,
    Rust,
    C,
    Cpp,
    Java,
    JavaScript,
    TypeScript,
}

impl LanguageId {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "python" | "py" => Some(Self::Python),
            "go" | "golang" => Some(Self::Go),
            "rust" | "rs" => Some(Self::Rust),
            "c" => Some(Self::C),
            "cpp" | "c++" | "cxx" => Some(Self::Cpp),
            "java" => Some(Self::Java),
            "javascript" | "js" => Some(Self::JavaScript),
            "typescript" | "ts" => Some(Self::TypeScript),
            _ => None,
        }
    }

    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "py" => Some(Self::Python),
            "go" => Some(Self::Go),
            "rs" => Some(Self::Rust),
            "c" | "h" => Some(Self::C),
            "cpp" | "cxx" | "cc" | "hpp" | "hxx" => Some(Self::Cpp),
            "java" => Some(Self::Java),
            "js" | "mjs" | "cjs" => Some(Self::JavaScript),
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Python => "python",
            Self::Go => "go",
            Self::Rust => "rust",
            Self::C => "c",
            Self::Cpp => "cpp",
            Self::Java => "java",
            Self::JavaScript => "javascript",
            Self::TypeScript => "typescript",
        }
    }
}

/// Multi-language parser wrapper
pub struct LanguageParser {
    parser: Parser,
    current_language: Option<LanguageId>,
}

impl LanguageParser {
    pub fn new() -> Self {
        Self {
            parser: Parser::new(),
            current_language: None,
        }
    }

    /// Set the language for parsing
    #[cfg(not(target_arch = "wasm32"))]
    pub fn set_language(&mut self, lang: LanguageId) -> Result<(), ParseError> {
        let language = match lang {
            LanguageId::Python => tree_sitter_python::LANGUAGE.into(),
            LanguageId::Go => tree_sitter_go::LANGUAGE.into(),
            LanguageId::Rust => tree_sitter_rust::LANGUAGE.into(),
            LanguageId::C => tree_sitter_c::LANGUAGE.into(),
            LanguageId::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            LanguageId::Java => tree_sitter_java::LANGUAGE.into(),
            LanguageId::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            LanguageId::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        };

        self.parser
            .set_language(&language)
            .map_err(|e| ParseError::LanguageError(e.to_string()))?;
        self.current_language = Some(lang);
        Ok(())
    }

    /// Set language for WASM target (languages loaded externally)
    #[cfg(target_arch = "wasm32")]
    pub fn set_language(&mut self, _lang: LanguageId) -> Result<(), ParseError> {
        // In WASM, languages are loaded via JavaScript
        Err(ParseError::LanguageError(
            "Use set_language_wasm for WASM target".to_string(),
        ))
    }

    /// Set language from externally loaded tree-sitter language (for WASM)
    pub fn set_language_raw(&mut self, language: Language, lang_id: LanguageId) -> Result<(), ParseError> {
        self.parser
            .set_language(&language)
            .map_err(|e| ParseError::LanguageError(e.to_string()))?;
        self.current_language = Some(lang_id);
        Ok(())
    }

    /// Parse source code
    pub fn parse(&mut self, source: &str, old_tree: Option<&Tree>) -> Result<Tree, ParseError> {
        self.parser
            .parse(source, old_tree)
            .ok_or(ParseError::ParseFailed)
    }

    /// Get current language
    pub fn current_language(&self) -> Option<LanguageId> {
        self.current_language
    }
}

impl Default for LanguageParser {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract diagnostics from parse errors in the tree
pub fn extract_parse_errors(tree: &Tree, source: &str) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let mut cursor = tree.walk();

    extract_errors_recursive(&mut cursor, source, &mut diagnostics);
    diagnostics
}

fn extract_errors_recursive(
    cursor: &mut tree_sitter::TreeCursor,
    source: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let node = cursor.node();

    if node.is_error() || node.is_missing() {
        let range = node_to_range(&node);
        let message = if node.is_missing() {
            format!("Missing {}", node.kind())
        } else {
            "Syntax error".to_string()
        };
        diagnostics.push(
            Diagnostic::error(range, message).with_source("logos-parser".to_string()),
        );
    }

    if cursor.goto_first_child() {
        loop {
            extract_errors_recursive(cursor, source, diagnostics);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
        cursor.goto_parent();
    }
}

/// Convert tree-sitter node range to logos Range
pub fn node_to_range(node: &Node) -> Range {
    let start = node.start_position();
    let end = node.end_position();
    Range::from_coords(
        start.row as u32,
        start.column as u32,
        end.row as u32,
        end.column as u32,
    )
}

/// Convert tree-sitter point to logos Position
pub fn point_to_position(point: tree_sitter::Point) -> Position {
    Position::new(point.row as u32, point.column as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_id_from_str() {
        assert_eq!(LanguageId::from_str("python"), Some(LanguageId::Python));
        assert_eq!(LanguageId::from_str("Python"), Some(LanguageId::Python));
        assert_eq!(LanguageId::from_str("rust"), Some(LanguageId::Rust));
        assert_eq!(LanguageId::from_str("unknown"), None);
    }

    #[test]
    fn test_language_id_from_extension() {
        assert_eq!(LanguageId::from_extension("py"), Some(LanguageId::Python));
        assert_eq!(LanguageId::from_extension("rs"), Some(LanguageId::Rust));
        assert_eq!(LanguageId::from_extension("ts"), Some(LanguageId::TypeScript));
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn test_parse_python() {
        let mut parser = LanguageParser::new();
        parser.set_language(LanguageId::Python).unwrap();

        let tree = parser.parse("def hello(): pass", None).unwrap();
        assert!(!tree.root_node().has_error());
    }
}
