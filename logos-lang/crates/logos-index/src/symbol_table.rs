//! Smart Mode Symbol Table
//!
//! Full-project symbol indexing for advanced code intelligence.
//! This module provides a comprehensive symbol table that tracks:
//! - All symbols with their types, visibility, and documentation
//! - Symbol references and usage
//! - Call relationships between functions
//! - Type hierarchy (inheritance, implementations)

use dashmap::DashMap;
use logos_core::{Position, Range, SymbolKind};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Unique identifier for a symbol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SymbolId(pub u64);

impl SymbolId {
    pub fn new() -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        Self(COUNTER.fetch_add(1, Ordering::SeqCst))
    }
}

/// Visibility of a symbol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Visibility {
    /// Public - accessible from anywhere
    Public,
    /// Protected - accessible from subclasses
    Protected,
    /// Private - accessible only within the defining scope
    Private,
    /// Internal - accessible within the same package/module
    Internal,
}

impl Default for Visibility {
    fn default() -> Self {
        Self::Public
    }
}

/// Type information for a symbol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeInfo {
    /// Type expression (e.g., "string", "number[]", "Promise<User>")
    pub type_expr: String,
    /// Whether the type is nullable
    pub nullable: bool,
    /// Generic type parameters
    pub type_params: Vec<String>,
    /// Return type (for functions)
    pub return_type: Option<Box<TypeInfo>>,
    /// Parameter types (for functions)
    pub param_types: Vec<TypeInfo>,
}

impl TypeInfo {
    pub fn simple(type_expr: impl Into<String>) -> Self {
        Self {
            type_expr: type_expr.into(),
            nullable: false,
            type_params: Vec::new(),
            return_type: None,
            param_types: Vec::new(),
        }
    }

    pub fn function(params: Vec<TypeInfo>, return_type: TypeInfo) -> Self {
        Self {
            type_expr: "function".to_string(),
            nullable: false,
            type_params: Vec::new(),
            return_type: Some(Box::new(return_type)),
            param_types: params,
        }
    }
}

/// An attribute/decorator on a symbol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attribute {
    pub name: String,
    pub arguments: Vec<String>,
}

/// A symbol in the symbol table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartSymbol {
    /// Unique identifier
    pub id: SymbolId,
    /// Symbol name
    pub name: String,
    /// Symbol kind
    pub kind: SymbolKind,
    /// File location
    pub location: SymbolLocation,
    /// Parent symbol (for nested symbols)
    pub parent: Option<SymbolId>,
    /// Child symbols
    pub children: Vec<SymbolId>,
    /// Type information
    pub type_info: Option<TypeInfo>,
    /// Visibility
    pub visibility: Visibility,
    /// Documentation string
    pub documentation: Option<String>,
    /// Attributes/decorators
    pub attributes: Vec<Attribute>,
    /// Whether this symbol is exported
    pub exported: bool,
    /// Full qualified name (e.g., "module.Class.method")
    pub qualified_name: String,
}

/// Location of a symbol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolLocation {
    /// File path
    pub uri: String,
    /// Full range (including body)
    pub range: Range,
    /// Selection range (just the name)
    pub selection_range: Range,
}

/// A reference to a symbol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolReference {
    /// The symbol being referenced
    pub symbol_id: SymbolId,
    /// Location of the reference
    pub location: SymbolLocation,
    /// Whether this is the definition
    pub is_definition: bool,
    /// Whether this is a write (assignment)
    pub is_write: bool,
}

/// Type of a call
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CallType {
    /// Direct function call
    Direct,
    /// Virtual/dynamic method call
    Virtual,
    /// Interface method call
    Interface,
    /// Callback invocation
    Callback,
    /// Constructor call
    Constructor,
}

/// A call site in the call graph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallSite {
    /// The calling function
    pub caller: SymbolId,
    /// The called function
    pub callee: SymbolId,
    /// Location of the call
    pub location: SymbolLocation,
    /// Type of call
    pub call_type: CallType,
}

/// The main symbol table structure
pub struct SymbolTable {
    /// All symbols indexed by ID
    symbols: DashMap<SymbolId, SmartSymbol>,

    /// Symbols indexed by file
    file_symbols: DashMap<String, Vec<SymbolId>>,

    /// Symbols indexed by name (for quick lookup)
    name_index: DashMap<String, Vec<SymbolId>>,

    /// Symbols indexed by qualified name
    qualified_name_index: DashMap<String, SymbolId>,

    /// All references
    references: DashMap<SymbolId, Vec<SymbolReference>>,
}

impl SymbolTable {
    pub fn new() -> Self {
        Self {
            symbols: DashMap::new(),
            file_symbols: DashMap::new(),
            name_index: DashMap::new(),
            qualified_name_index: DashMap::new(),
            references: DashMap::new(),
        }
    }

    /// Add a symbol to the table
    pub fn add_symbol(&self, symbol: SmartSymbol) -> SymbolId {
        let id = symbol.id;
        let name = symbol.name.clone();
        let qualified_name = symbol.qualified_name.clone();
        let uri = symbol.location.uri.clone();

        // Add to main index
        self.symbols.insert(id, symbol);

        // Add to file index
        self.file_symbols.entry(uri).or_default().push(id);

        // Add to name index
        self.name_index.entry(name).or_default().push(id);

        // Add to qualified name index
        self.qualified_name_index.insert(qualified_name, id);

        id
    }

    /// Get a symbol by ID
    pub fn get(&self, id: SymbolId) -> Option<SmartSymbol> {
        self.symbols.get(&id).map(|s| s.clone())
    }

    /// Find symbols by name
    pub fn find_by_name(&self, name: &str) -> Vec<SmartSymbol> {
        self.name_index
            .get(name)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.symbols.get(id).map(|s| s.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Find symbol by qualified name
    pub fn find_by_qualified_name(&self, qualified_name: &str) -> Option<SmartSymbol> {
        self.qualified_name_index
            .get(qualified_name)
            .and_then(|id| self.symbols.get(&id).map(|s| s.clone()))
    }

    /// Get all symbols in a file
    pub fn get_file_symbols(&self, uri: &str) -> Vec<SmartSymbol> {
        self.file_symbols
            .get(uri)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.symbols.get(id).map(|s| s.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Remove all symbols from a file
    pub fn remove_file(&self, uri: &str) {
        if let Some((_, ids)) = self.file_symbols.remove(uri) {
            for id in ids {
                if let Some((_, symbol)) = self.symbols.remove(&id) {
                    // Remove from name index
                    if let Some(mut entry) = self.name_index.get_mut(&symbol.name) {
                        entry.retain(|i| *i != id);
                    }
                    // Remove from qualified name index
                    self.qualified_name_index.remove(&symbol.qualified_name);
                    // Remove references
                    self.references.remove(&id);
                }
            }
        }
    }

    /// Add a reference to a symbol
    pub fn add_reference(&self, reference: SymbolReference) {
        self.references
            .entry(reference.symbol_id)
            .or_default()
            .push(reference);
    }

    /// Get all references to a symbol
    pub fn get_references(&self, id: SymbolId) -> Vec<SymbolReference> {
        self.references
            .get(&id)
            .map(|refs| refs.clone())
            .unwrap_or_default()
    }

    /// Search symbols by query
    pub fn search(&self, query: &str) -> Vec<SmartSymbol> {
        let query_lower = query.to_lowercase();
        let mut results = Vec::new();

        for entry in self.symbols.iter() {
            if entry.name.to_lowercase().contains(&query_lower) {
                results.push(entry.clone());
            }
        }

        results
    }

    /// Find symbol at a position in a file
    pub fn find_at_position(&self, uri: &str, position: Position) -> Option<SmartSymbol> {
        self.get_file_symbols(uri)
            .into_iter()
            .find(|s| s.location.selection_range.contains(position))
    }

    /// Get symbol count
    pub fn len(&self) -> usize {
        self.symbols.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.symbols.is_empty()
    }

    /// Get all file URIs
    pub fn files(&self) -> Vec<String> {
        self.file_symbols.iter().map(|e| e.key().clone()).collect()
    }
}

impl Default for SymbolTable {
    fn default() -> Self {
        Self::new()
    }
}

/// Call graph for tracking function calls
pub struct CallGraph {
    /// Outgoing calls: caller -> callees
    callers: DashMap<SymbolId, HashSet<CallSite>>,
    /// Incoming calls: callee -> callers
    callees: DashMap<SymbolId, HashSet<CallSite>>,
}

impl CallGraph {
    pub fn new() -> Self {
        Self {
            callers: DashMap::new(),
            callees: DashMap::new(),
        }
    }

    /// Add a call relationship
    pub fn add_call(&self, call: CallSite) {
        // Add to caller's outgoing calls
        self.callers
            .entry(call.caller)
            .or_default()
            .insert(call.clone());

        // Add to callee's incoming calls
        self.callees
            .entry(call.callee)
            .or_default()
            .insert(call);
    }

    /// Get all functions called by a function
    pub fn get_callees(&self, caller: SymbolId) -> Vec<CallSite> {
        self.callers
            .get(&caller)
            .map(|calls| calls.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get all functions that call a function
    pub fn get_callers(&self, callee: SymbolId) -> Vec<CallSite> {
        self.callees
            .get(&callee)
            .map(|calls| calls.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Remove all calls from a file
    pub fn remove_file(&self, file_uri: &str) {
        // Remove calls where the location matches the file
        for mut entry in self.callers.iter_mut() {
            entry.retain(|call| call.location.uri != file_uri);
        }
        for mut entry in self.callees.iter_mut() {
            entry.retain(|call| call.location.uri != file_uri);
        }
    }
}

impl Default for CallGraph {
    fn default() -> Self {
        Self::new()
    }
}

// Implement Hash and Eq for CallSite to use in HashSet
impl std::hash::Hash for CallSite {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.caller.hash(state);
        self.callee.hash(state);
        self.location.uri.hash(state);
        self.location.range.start.line.hash(state);
        self.location.range.start.column.hash(state);
    }
}

impl PartialEq for CallSite {
    fn eq(&self, other: &Self) -> bool {
        self.caller == other.caller
            && self.callee == other.callee
            && self.location.uri == other.location.uri
            && self.location.range.start == other.location.range.start
    }
}

impl Eq for CallSite {}

/// Type hierarchy for tracking inheritance
pub struct TypeHierarchy {
    /// Supertype relationships: subtype -> supertypes
    supertypes: DashMap<SymbolId, Vec<SymbolId>>,
    /// Subtype relationships: supertype -> subtypes
    subtypes: DashMap<SymbolId, Vec<SymbolId>>,
    /// Interface implementations: implementor -> interfaces
    implements: DashMap<SymbolId, Vec<SymbolId>>,
    /// Interface implementors: interface -> implementors
    implementors: DashMap<SymbolId, Vec<SymbolId>>,
}

impl TypeHierarchy {
    pub fn new() -> Self {
        Self {
            supertypes: DashMap::new(),
            subtypes: DashMap::new(),
            implements: DashMap::new(),
            implementors: DashMap::new(),
        }
    }

    /// Add an inheritance relationship
    pub fn add_extends(&self, subtype: SymbolId, supertype: SymbolId) {
        self.supertypes.entry(subtype).or_default().push(supertype);
        self.subtypes.entry(supertype).or_default().push(subtype);
    }

    /// Add an implementation relationship
    pub fn add_implements(&self, implementor: SymbolId, interface: SymbolId) {
        self.implements.entry(implementor).or_default().push(interface);
        self.implementors.entry(interface).or_default().push(implementor);
    }

    /// Get all supertypes of a type
    pub fn get_supertypes(&self, type_id: SymbolId) -> Vec<SymbolId> {
        self.supertypes
            .get(&type_id)
            .map(|v| v.clone())
            .unwrap_or_default()
    }

    /// Get all subtypes of a type
    pub fn get_subtypes(&self, type_id: SymbolId) -> Vec<SymbolId> {
        self.subtypes
            .get(&type_id)
            .map(|v| v.clone())
            .unwrap_or_default()
    }

    /// Get all interfaces implemented by a type
    pub fn get_interfaces(&self, type_id: SymbolId) -> Vec<SymbolId> {
        self.implements
            .get(&type_id)
            .map(|v| v.clone())
            .unwrap_or_default()
    }

    /// Get all implementors of an interface
    pub fn get_implementors(&self, interface_id: SymbolId) -> Vec<SymbolId> {
        self.implementors
            .get(&interface_id)
            .map(|v| v.clone())
            .unwrap_or_default()
    }
}

impl Default for TypeHierarchy {
    fn default() -> Self {
        Self::new()
    }
}

/// Dependency graph for tracking file imports
pub struct DependencyGraph {
    /// File imports: file -> imported files
    imports: DashMap<PathBuf, HashSet<PathBuf>>,
    /// Reverse imports: file -> files that import it
    imported_by: DashMap<PathBuf, HashSet<PathBuf>>,
    /// Exported symbols per file
    exports: DashMap<PathBuf, Vec<SymbolId>>,
}

impl DependencyGraph {
    pub fn new() -> Self {
        Self {
            imports: DashMap::new(),
            imported_by: DashMap::new(),
            exports: DashMap::new(),
        }
    }

    /// Add an import relationship
    pub fn add_import(&self, from: PathBuf, to: PathBuf) {
        self.imports.entry(from.clone()).or_default().insert(to.clone());
        self.imported_by.entry(to).or_default().insert(from);
    }

    /// Set exports for a file
    pub fn set_exports(&self, file: PathBuf, symbols: Vec<SymbolId>) {
        self.exports.insert(file, symbols);
    }

    /// Get files imported by a file
    pub fn get_imports(&self, file: &PathBuf) -> Vec<PathBuf> {
        self.imports
            .get(file)
            .map(|v| v.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get files that import a file
    pub fn get_importers(&self, file: &PathBuf) -> Vec<PathBuf> {
        self.imported_by
            .get(file)
            .map(|v| v.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get exported symbols from a file
    pub fn get_exports(&self, file: &PathBuf) -> Vec<SymbolId> {
        self.exports
            .get(file)
            .map(|v| v.clone())
            .unwrap_or_default()
    }

    /// Remove a file from the graph
    pub fn remove_file(&self, file: &PathBuf) {
        // Remove imports from this file
        if let Some((_, imported)) = self.imports.remove(file) {
            for imported_file in imported {
                if let Some(mut entry) = self.imported_by.get_mut(&imported_file) {
                    entry.remove(file);
                }
            }
        }

        // Remove reverse imports
        if let Some((_, importers)) = self.imported_by.remove(file) {
            for importer in importers {
                if let Some(mut entry) = self.imports.get_mut(&importer) {
                    entry.remove(file);
                }
            }
        }

        // Remove exports
        self.exports.remove(file);
    }
}

impl Default for DependencyGraph {
    fn default() -> Self {
        Self::new()
    }
}

/// Combined project index containing all index structures
pub struct ProjectIndex {
    /// Symbol table
    pub symbols: Arc<SymbolTable>,
    /// Call graph
    pub call_graph: Arc<CallGraph>,
    /// Type hierarchy
    pub type_hierarchy: Arc<TypeHierarchy>,
    /// Dependency graph
    pub dependencies: Arc<DependencyGraph>,
}

impl ProjectIndex {
    pub fn new() -> Self {
        Self {
            symbols: Arc::new(SymbolTable::new()),
            call_graph: Arc::new(CallGraph::new()),
            type_hierarchy: Arc::new(TypeHierarchy::new()),
            dependencies: Arc::new(DependencyGraph::new()),
        }
    }

    /// Remove all data for a file (for incremental updates)
    pub fn remove_file(&self, uri: &str) {
        self.symbols.remove_file(uri);
        self.call_graph.remove_file(uri);
        self.dependencies.remove_file(&PathBuf::from(uri));
    }
}

impl Default for ProjectIndex {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use logos_core::Position;

    #[test]
    fn test_symbol_table_basic() {
        let table = SymbolTable::new();

        let symbol = SmartSymbol {
            id: SymbolId::new(),
            name: "foo".to_string(),
            kind: SymbolKind::Function,
            location: SymbolLocation {
                uri: "file:///test.ts".to_string(),
                range: Range {
                    start: Position { line: 0, column: 0 },
                    end: Position { line: 10, column: 0 },
                },
                selection_range: Range {
                    start: Position { line: 0, column: 9 },
                    end: Position { line: 0, column: 12 },
                },
            },
            parent: None,
            children: vec![],
            type_info: Some(TypeInfo::simple("() => void")),
            visibility: Visibility::Public,
            documentation: Some("A test function".to_string()),
            attributes: vec![],
            exported: true,
            qualified_name: "test.foo".to_string(),
        };

        let id = table.add_symbol(symbol.clone());

        // Test retrieval
        let retrieved = table.get(id).unwrap();
        assert_eq!(retrieved.name, "foo");

        // Test find by name
        let found = table.find_by_name("foo");
        assert_eq!(found.len(), 1);

        // Test search
        let searched = table.search("fo");
        assert_eq!(searched.len(), 1);
    }

    #[test]
    fn test_call_graph() {
        let graph = CallGraph::new();

        let caller = SymbolId::new();
        let callee = SymbolId::new();

        let call = CallSite {
            caller,
            callee,
            location: SymbolLocation {
                uri: "file:///test.ts".to_string(),
                range: Range {
                    start: Position { line: 5, column: 0 },
                    end: Position { line: 5, column: 10 },
                },
                selection_range: Range {
                    start: Position { line: 5, column: 0 },
                    end: Position { line: 5, column: 10 },
                },
            },
            call_type: CallType::Direct,
        };

        graph.add_call(call);

        let callees = graph.get_callees(caller);
        assert_eq!(callees.len(), 1);

        let callers = graph.get_callers(callee);
        assert_eq!(callers.len(), 1);
    }
}
