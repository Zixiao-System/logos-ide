//! Project Indexer
//!
//! Coordinates language adapters and the project index to index entire projects.

use crate::adapter::{AnalysisResult, LanguageAdapter};
use crate::symbol_table::{CallSite, CallType, ProjectIndex};
use crate::typescript_adapter::TypeScriptAdapter;
use std::fs;
use std::path::Path;
use std::sync::Arc;

/// Project indexer that coordinates language adapters
pub struct ProjectIndexer {
    /// The project index containing all indexed data
    pub index: Arc<ProjectIndex>,
    /// Available language adapters
    adapters: Vec<Box<dyn LanguageAdapter>>,
}

impl ProjectIndexer {
    pub fn new() -> Self {
        let mut indexer = Self {
            index: Arc::new(ProjectIndex::new()),
            adapters: Vec::new(),
        };

        // Register built-in adapters
        if let Ok(ts_adapter) = TypeScriptAdapter::new() {
            indexer.register_adapter(Box::new(ts_adapter));
        }

        indexer
    }

    /// Register a language adapter
    pub fn register_adapter(&mut self, adapter: Box<dyn LanguageAdapter>) {
        self.adapters.push(adapter);
    }

    /// Find an adapter for a file
    fn find_adapter(&self, path: &Path) -> Option<&dyn LanguageAdapter> {
        self.adapters
            .iter()
            .find(|a| a.can_handle(path))
            .map(|a| a.as_ref())
    }

    /// Index a single file
    pub fn index_file(&self, path: &Path) -> Result<AnalysisResult, String> {
        let adapter = self
            .find_adapter(path)
            .ok_or_else(|| format!("No adapter found for {:?}", path))?;

        let content = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read file {:?}: {}", path, e))?;

        let uri = path_to_uri(path);
        let result = adapter.analyze(&uri, &content);

        // Add symbols to the index
        for symbol in &result.symbols {
            self.index.symbols.add_symbol(symbol.clone());
        }

        // Add call sites to call graph
        for call in &result.calls {
            // For now, we create placeholder symbol IDs
            // In a full implementation, we'd resolve the callee to an actual symbol
            if let Some(caller_scope) = result.symbols.iter().find(|s| {
                s.location.range.start.line <= call.location.start.line
                    && s.location.range.end.line >= call.location.end.line
            }) {
                // We'd need to resolve call.callee_name to a SymbolId
                // For now, this is a placeholder showing the structure
                let call_site = CallSite {
                    caller: caller_scope.id,
                    callee: caller_scope.id, // Placeholder - should be resolved
                    location: crate::symbol_table::SymbolLocation {
                        uri: uri.clone(),
                        range: call.location,
                        selection_range: call.location,
                    },
                    call_type: if call.is_constructor {
                        CallType::Constructor
                    } else {
                        CallType::Direct
                    },
                };
                self.index.call_graph.add_call(call_site);
            }
        }

        // Add type relationships
        for relation in &result.type_relations {
            // Find the child symbol
            if let Some(child) = result
                .symbols
                .iter()
                .find(|s| s.name == relation.child_name)
            {
                // Find or create the parent symbol reference
                // In a full implementation, we'd resolve across files
                if let Some(parent) = result
                    .symbols
                    .iter()
                    .find(|s| s.name == relation.parent_name)
                {
                    if relation.is_implements {
                        self.index.type_hierarchy.add_implements(child.id, parent.id);
                    } else {
                        self.index.type_hierarchy.add_extends(child.id, parent.id);
                    }
                }
            }
        }

        // Add imports to dependency graph
        let file_path = path.to_path_buf();
        for import in &result.imports {
            if let Some(resolved) = adapter.resolve_import(path, &import.module_path) {
                self.index.dependencies.add_import(file_path.clone(), resolved);
            }
        }

        // Set exports
        let export_symbols: Vec<_> = result
            .symbols
            .iter()
            .filter(|s| s.exported)
            .map(|s| s.id)
            .collect();
        self.index.dependencies.set_exports(file_path, export_symbols);

        Ok(result)
    }

    /// Index a directory recursively
    pub fn index_directory(&self, dir: &Path) -> Result<IndexingStats, String> {
        let mut stats = IndexingStats::default();

        self.index_directory_recursive(dir, &mut stats)?;

        Ok(stats)
    }

    fn index_directory_recursive(&self, dir: &Path, stats: &mut IndexingStats) -> Result<(), String> {
        let entries = fs::read_dir(dir)
            .map_err(|e| format!("Failed to read directory {:?}: {}", dir, e))?;

        for entry in entries.flatten() {
            let path = entry.path();

            // Skip hidden files and common ignored directories
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "target"
                    || name == "dist"
                    || name == "build"
                    || name == "__pycache__"
                {
                    continue;
                }
            }

            if path.is_dir() {
                self.index_directory_recursive(&path, stats)?;
            } else if path.is_file() {
                if self.find_adapter(&path).is_some() {
                    match self.index_file(&path) {
                        Ok(result) => {
                            stats.files_indexed += 1;
                            stats.symbols_found += result.symbols.len();
                            stats.imports_found += result.imports.len();
                            stats.exports_found += result.exports.len();
                            stats.calls_found += result.calls.len();
                            stats.type_relations_found += result.type_relations.len();
                        }
                        Err(e) => {
                            stats.errors.push(format!("{:?}: {}", path, e));
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Re-index a single file (for incremental updates)
    pub fn reindex_file(&self, path: &Path) -> Result<AnalysisResult, String> {
        let uri = path_to_uri(path);

        // Remove old data for this file
        self.index.remove_file(&uri);

        // Re-index
        self.index_file(path)
    }

    /// Get the project index
    pub fn get_index(&self) -> Arc<ProjectIndex> {
        Arc::clone(&self.index)
    }
}

impl Default for ProjectIndexer {
    fn default() -> Self {
        Self::new()
    }
}

/// Statistics from indexing
#[derive(Debug, Default)]
pub struct IndexingStats {
    pub files_indexed: usize,
    pub symbols_found: usize,
    pub imports_found: usize,
    pub exports_found: usize,
    pub calls_found: usize,
    pub type_relations_found: usize,
    pub errors: Vec<String>,
}

/// Convert a file path to a URI
fn path_to_uri(path: &Path) -> String {
    format!("file://{}", path.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_index_single_file() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.ts");

        let mut file = fs::File::create(&file_path).unwrap();
        writeln!(
            file,
            r#"
export function greet(name: string): string {{
    return `Hello, ${{name}}!`;
}}

export class User {{
    constructor(public name: string) {{}}
}}
"#
        )
        .unwrap();

        let indexer = ProjectIndexer::new();
        let result = indexer.index_file(&file_path).unwrap();

        assert!(result.symbols.len() >= 2);
        assert!(result.exports.len() >= 2);
    }

    #[test]
    fn test_index_directory() {
        let dir = tempdir().unwrap();

        // Create some test files
        let file1 = dir.path().join("index.ts");
        fs::write(
            &file1,
            r#"
export { User } from './user';
export function main() { console.log('Hello'); }
"#,
        )
        .unwrap();

        let file2 = dir.path().join("user.ts");
        fs::write(
            &file2,
            r#"
export class User {
    name: string = '';
}
"#,
        )
        .unwrap();

        let indexer = ProjectIndexer::new();
        let stats = indexer.index_directory(dir.path()).unwrap();

        assert_eq!(stats.files_indexed, 2);
        assert!(stats.symbols_found >= 3);
    }
}
