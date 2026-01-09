//! Global state management for the language service

use std::collections::HashMap;
use logos_core::Document;
use logos_index::{SymbolIndex, TodoIndex};

/// Global state for the language service daemon
pub struct State {
    /// Open documents by URI
    pub documents: HashMap<String, Document>,
    /// Symbol index
    pub symbol_index: SymbolIndex,
    /// TODO index
    pub todo_index: TodoIndex,
    /// Whether the server has been initialized
    pub initialized: bool,
    /// Root path of the workspace
    pub root_path: Option<String>,
}

impl State {
    pub fn new() -> Self {
        Self {
            documents: HashMap::new(),
            symbol_index: SymbolIndex::new(),
            todo_index: TodoIndex::new(),
            initialized: false,
            root_path: None,
        }
    }

    /// Open a document
    pub fn open_document(&mut self, uri: String, language_id: String, content: String) {
        let doc = Document::new(uri.clone(), language_id, content.clone());
        self.documents.insert(uri.clone(), doc);
        // Index TODOs
        self.todo_index.index_document(&uri, &content);
    }

    /// Update a document
    pub fn update_document(&mut self, uri: &str, content: String) {
        if let Some(doc) = self.documents.get_mut(uri) {
            doc.set_content(content.clone());
        }
        // Re-index TODOs
        self.todo_index.index_document(uri, &content);
    }

    /// Close a document
    pub fn close_document(&mut self, uri: &str) {
        self.documents.remove(uri);
        self.symbol_index.remove_document(uri);
        self.todo_index.remove_document(uri);
    }

    /// Get a document by URI
    pub fn get_document(&self, uri: &str) -> Option<&Document> {
        self.documents.get(uri)
    }

    /// Get all open document URIs
    pub fn get_open_documents(&self) -> Vec<String> {
        self.documents.keys().cloned().collect()
    }
}

impl Default for State {
    fn default() -> Self {
        Self::new()
    }
}
