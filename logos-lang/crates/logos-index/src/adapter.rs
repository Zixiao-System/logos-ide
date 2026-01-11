//! Language Adapter Trait
//!
//! Defines the interface for language-specific symbol extraction and analysis.
//! Each language implements this trait to provide Smart Mode indexing.

use crate::symbol_table::{
    SmartSymbol, SymbolId, SymbolLocation, SymbolReference, TypeInfo, Visibility,
};
use logos_core::{Range, SymbolKind};
use std::path::Path;

/// Import information extracted from source
#[derive(Debug, Clone)]
pub struct ImportInfo {
    /// Module path or name being imported
    pub module_path: String,
    /// Specific items imported (empty for namespace import)
    pub items: Vec<ImportItem>,
    /// Whether this is a type-only import
    pub is_type_only: bool,
    /// Location of the import statement
    pub location: Range,
}

/// A single imported item
#[derive(Debug, Clone)]
pub struct ImportItem {
    /// Original name in the source module
    pub name: String,
    /// Alias if renamed (e.g., `import { foo as bar }`)
    pub alias: Option<String>,
    /// Whether this is a type import
    pub is_type: bool,
}

/// Export information extracted from source
#[derive(Debug, Clone)]
pub struct ExportInfo {
    /// Name being exported
    pub name: String,
    /// Original name if re-exporting with alias
    pub original_name: Option<String>,
    /// Source module if re-exporting
    pub from_module: Option<String>,
    /// Whether this is a type-only export
    pub is_type_only: bool,
    /// Whether this is the default export
    pub is_default: bool,
    /// Location of the export
    pub location: Range,
}

/// A function call site
#[derive(Debug, Clone)]
pub struct CallInfo {
    /// Name of the function being called
    pub callee_name: String,
    /// Qualified name if available (e.g., `obj.method`)
    pub qualified_name: Option<String>,
    /// Location of the call
    pub location: Range,
    /// Whether this is a constructor call (new)
    pub is_constructor: bool,
}

/// Type relationship (extends or implements)
#[derive(Debug, Clone)]
pub struct TypeRelation {
    /// The type that extends/implements
    pub child_name: String,
    /// The parent type or interface
    pub parent_name: String,
    /// Whether this is an implements (vs extends)
    pub is_implements: bool,
    /// Location of the relationship declaration
    pub location: Range,
}

/// Result of analyzing a source file
#[derive(Debug, Default)]
pub struct AnalysisResult {
    /// Symbols defined in this file
    pub symbols: Vec<SmartSymbol>,
    /// Imports in this file
    pub imports: Vec<ImportInfo>,
    /// Exports from this file
    pub exports: Vec<ExportInfo>,
    /// Function calls in this file
    pub calls: Vec<CallInfo>,
    /// Type relationships (extends/implements)
    pub type_relations: Vec<TypeRelation>,
    /// References to symbols
    pub references: Vec<SymbolReference>,
}

/// Language adapter trait for Smart Mode indexing
pub trait LanguageAdapter: Send + Sync {
    /// Returns the language identifier (e.g., "typescript", "rust")
    fn language_id(&self) -> &str;

    /// Returns file extensions this adapter handles
    fn file_extensions(&self) -> &[&str];

    /// Check if this adapter can handle the given file
    fn can_handle(&self, path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            self.file_extensions().iter().any(|e| *e == ext)
        } else {
            false
        }
    }

    /// Analyze a source file and extract symbols, imports, exports, calls, etc.
    fn analyze(&self, uri: &str, source: &str) -> AnalysisResult;

    /// Resolve an import path to an absolute file path
    fn resolve_import(&self, from_file: &Path, import_path: &str) -> Option<std::path::PathBuf> {
        // Default implementation for relative imports
        if import_path.starts_with('.') {
            let parent = from_file.parent()?;
            let resolved = parent.join(import_path);

            // Try with various extensions
            for ext in self.file_extensions() {
                let with_ext = resolved.with_extension(ext);
                if with_ext.exists() {
                    return Some(with_ext);
                }
                // Try index file
                let index = resolved.join(format!("index.{}", ext));
                if index.exists() {
                    return Some(index);
                }
            }
        }
        None
    }
}

/// Helper to create a SymbolLocation
pub fn make_location(uri: &str, range: Range, selection_range: Range) -> SymbolLocation {
    SymbolLocation {
        uri: uri.to_string(),
        range,
        selection_range,
    }
}

/// Helper to build a SmartSymbol
pub struct SymbolBuilder {
    symbol: SmartSymbol,
}

impl SymbolBuilder {
    pub fn new(name: impl Into<String>, kind: SymbolKind, location: SymbolLocation) -> Self {
        Self {
            symbol: SmartSymbol {
                id: SymbolId::new(),
                name: name.into(),
                kind,
                location,
                parent: None,
                children: Vec::new(),
                type_info: None,
                visibility: Visibility::default(),
                documentation: None,
                attributes: Vec::new(),
                exported: false,
                qualified_name: String::new(),
            },
        }
    }

    pub fn parent(mut self, parent: SymbolId) -> Self {
        self.symbol.parent = Some(parent);
        self
    }

    pub fn type_info(mut self, type_info: TypeInfo) -> Self {
        self.symbol.type_info = Some(type_info);
        self
    }

    pub fn visibility(mut self, visibility: Visibility) -> Self {
        self.symbol.visibility = visibility;
        self
    }

    pub fn documentation(mut self, doc: impl Into<String>) -> Self {
        self.symbol.documentation = Some(doc.into());
        self
    }

    pub fn exported(mut self, exported: bool) -> Self {
        self.symbol.exported = exported;
        self
    }

    pub fn qualified_name(mut self, name: impl Into<String>) -> Self {
        self.symbol.qualified_name = name.into();
        self
    }

    pub fn build(self) -> SmartSymbol {
        self.symbol
    }
}
