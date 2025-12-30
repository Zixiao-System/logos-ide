//! Symbol resolution

use logos_core::{Position, Range, Symbol, SymbolKind};
use crate::scope::ScopeTree;

#[derive(Debug, Clone)]
pub struct ResolvedSymbol {
    pub name: String,
    pub kind: SymbolKind,
    pub definition_range: Range,
    pub selection_range: Range,
}

pub struct SymbolResolver<'a> {
    scope_tree: &'a ScopeTree,
    symbols: &'a [Symbol],
}

impl<'a> SymbolResolver<'a> {
    pub fn new(scope_tree: &'a ScopeTree, symbols: &'a [Symbol]) -> Self {
        Self { scope_tree, symbols }
    }

    pub fn find_symbol_at(&self, position: Position) -> Option<&Symbol> {
        self.find_in_symbols(self.symbols, position)
    }

    fn find_in_symbols(&self, symbols: &'a [Symbol], position: Position) -> Option<&'a Symbol> {
        for symbol in symbols {
            if symbol.selection_range.contains(position) {
                return Some(symbol);
            }
            if symbol.range.contains(position) {
                if let Some(child) = self.find_in_symbols(&symbol.children, position) {
                    return Some(child);
                }
            }
        }
        None
    }

    pub fn find_definition(&self, name: &str, from_position: Position) -> Option<&Symbol> {
        let scope_id = self.scope_tree.scope_at(from_position);
        self.search_scopes_for_definition(name, scope_id)
    }

    fn search_scopes_for_definition(&self, name: &str, scope_id: Option<usize>) -> Option<&Symbol> {
        let scope_id = scope_id?;
        let scope = self.scope_tree.get_scope(scope_id)?;
        for symbol in self.symbols.iter() {
            if scope.range.contains(symbol.selection_range.start) && symbol.name == name {
                return Some(symbol);
            }
        }
        if let Some(parent_id) = scope.parent {
            return self.search_scopes_for_definition(name, Some(parent_id));
        }
        None
    }

    pub fn find_references(&self, symbol: &Symbol) -> Vec<Range> {
        vec![symbol.selection_range]
    }

    pub fn search_symbols(&self, query: &str) -> Vec<&Symbol> {
        let query_lower = query.to_lowercase();
        let mut results = Vec::new();
        self.search_symbols_recursive(self.symbols, &query_lower, &mut results);
        results
    }

    fn search_symbols_recursive<'b>(&self, symbols: &'b [Symbol], query: &str, results: &mut Vec<&'b Symbol>)
    where 'a: 'b {
        for symbol in symbols {
            if symbol.name.to_lowercase().contains(query) {
                results.push(symbol);
            }
            self.search_symbols_recursive(&symbol.children, query, results);
        }
    }
}
