//! Symbol types for language analysis

use crate::position::{Location, Range};
use serde::{Deserialize, Serialize};

/// The kind of a symbol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SymbolKind {
    File,
    Module,
    Namespace,
    Package,
    Class,
    Method,
    Property,
    Field,
    Constructor,
    Enum,
    Interface,
    Function,
    Variable,
    Constant,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Key,
    Null,
    EnumMember,
    Struct,
    Event,
    Operator,
    TypeParameter,
}

impl SymbolKind {
    /// Convert to Monaco editor symbol kind (1-indexed)
    pub fn to_monaco_kind(self) -> u32 {
        match self {
            SymbolKind::File => 1,
            SymbolKind::Module => 2,
            SymbolKind::Namespace => 3,
            SymbolKind::Package => 4,
            SymbolKind::Class => 5,
            SymbolKind::Method => 6,
            SymbolKind::Property => 7,
            SymbolKind::Field => 8,
            SymbolKind::Constructor => 9,
            SymbolKind::Enum => 10,
            SymbolKind::Interface => 11,
            SymbolKind::Function => 12,
            SymbolKind::Variable => 13,
            SymbolKind::Constant => 14,
            SymbolKind::String => 15,
            SymbolKind::Number => 16,
            SymbolKind::Boolean => 17,
            SymbolKind::Array => 18,
            SymbolKind::Object => 19,
            SymbolKind::Key => 20,
            SymbolKind::Null => 21,
            SymbolKind::EnumMember => 22,
            SymbolKind::Struct => 23,
            SymbolKind::Event => 24,
            SymbolKind::Operator => 25,
            SymbolKind::TypeParameter => 26,
        }
    }
}

/// A symbol in a document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Symbol {
    /// Symbol name
    pub name: String,
    /// Symbol kind
    pub kind: SymbolKind,
    /// Full range of the symbol (including body)
    pub range: Range,
    /// Range of the symbol name
    pub selection_range: Range,
    /// Detail information (e.g., type signature)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Children symbols (for hierarchical structure)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Symbol>,
}

impl Symbol {
    pub fn new(name: String, kind: SymbolKind, range: Range, selection_range: Range) -> Self {
        Self {
            name,
            kind,
            range,
            selection_range,
            detail: None,
            children: Vec::new(),
        }
    }

    pub fn with_detail(mut self, detail: String) -> Self {
        self.detail = Some(detail);
        self
    }

    pub fn with_children(mut self, children: Vec<Symbol>) -> Self {
        self.children = children;
        self
    }
}

/// Symbol information with location (for workspace symbols)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInformation {
    pub name: String,
    pub kind: SymbolKind,
    pub location: Location,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container_name: Option<String>,
}

impl SymbolInformation {
    pub fn new(name: String, kind: SymbolKind, location: Location) -> Self {
        Self {
            name,
            kind,
            location,
            container_name: None,
        }
    }

    pub fn with_container(mut self, container: String) -> Self {
        self.container_name = Some(container);
        self
    }
}

/// Scope for symbol visibility
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Scope {
    /// Global/module scope
    Global,
    /// Class/struct scope
    Class(String),
    /// Function/method scope
    Function(String),
    /// Block scope
    Block(u32),
}

impl Default for Scope {
    fn default() -> Self {
        Self::Global
    }
}