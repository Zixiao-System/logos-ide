//! Incremental index updates

use crate::SymbolIndex;
use logos_core::Symbol;
use std::collections::HashSet;

#[derive(Debug, Default)]
pub struct ChangeTracker {
    modified: HashSet<String>,
    deleted: HashSet<String>,
}

impl ChangeTracker {
    pub fn new() -> Self { Self::default() }

    pub fn mark_modified(&mut self, uri: &str) {
        self.deleted.remove(uri);
        self.modified.insert(uri.to_string());
    }

    pub fn mark_deleted(&mut self, uri: &str) {
        self.modified.remove(uri);
        self.deleted.insert(uri.to_string());
    }

    pub fn modified_documents(&self) -> impl Iterator<Item = &str> {
        self.modified.iter().map(|s| s.as_str())
    }

    pub fn deleted_documents(&self) -> impl Iterator<Item = &str> {
        self.deleted.iter().map(|s| s.as_str())
    }

    pub fn clear(&mut self) {
        self.modified.clear();
        self.deleted.clear();
    }

    pub fn has_changes(&self) -> bool {
        !self.modified.is_empty() || !self.deleted.is_empty()
    }
}

pub struct IncrementalIndexer {
    tracker: ChangeTracker,
}

impl IncrementalIndexer {
    pub fn new() -> Self { Self { tracker: ChangeTracker::new() } }

    pub fn document_changed(&mut self, uri: &str) { self.tracker.mark_modified(uri); }
    pub fn document_closed(&mut self, uri: &str) { self.tracker.mark_deleted(uri); }

    pub fn apply_changes<F>(&mut self, index: &mut SymbolIndex, mut get_symbols: F)
    where F: FnMut(&str) -> Option<Vec<Symbol>> {
        for uri in self.tracker.deleted_documents() {
            index.remove_document(uri);
        }
        let modified: Vec<_> = self.tracker.modified_documents().map(String::from).collect();
        for uri in modified {
            if let Some(symbols) = get_symbols(&uri) {
                index.index_document(&uri, &symbols);
            }
        }
        self.tracker.clear();
    }

    pub fn has_pending_changes(&self) -> bool { self.tracker.has_changes() }
}

impl Default for IncrementalIndexer {
    fn default() -> Self { Self::new() }
}
