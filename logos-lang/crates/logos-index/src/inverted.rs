//! Inverted index for fast symbol lookup

use std::collections::{HashMap, HashSet};

#[derive(Debug, Default)]
pub struct InvertedIndex {
    index: HashMap<String, HashSet<String>>,
}

impl InvertedIndex {
    pub fn new() -> Self { Self::default() }

    pub fn add(&mut self, name: &str, uri: &str) {
        let name_lower = name.to_lowercase();
        self.index.entry(name_lower.clone()).or_default().insert(uri.to_string());
        for i in 2..=name_lower.len() {
            let prefix = &name_lower[..i];
            self.index.entry(prefix.to_string()).or_default().insert(uri.to_string());
        }
    }

    pub fn remove(&mut self, name: &str, uri: &str) {
        let name_lower = name.to_lowercase();
        for i in 2..=name_lower.len() {
            let prefix = &name_lower[..i];
            if let Some(uris) = self.index.get_mut(prefix) {
                uris.remove(uri);
                if uris.is_empty() {
                    self.index.remove(prefix);
                }
            }
        }
    }

    pub fn search(&self, query: &str) -> Vec<String> {
        let query_lower = query.to_lowercase();
        self.index.get(&query_lower).map(|uris| uris.iter().cloned().collect()).unwrap_or_default()
    }

    pub fn clear(&mut self) { self.index.clear(); }
}
