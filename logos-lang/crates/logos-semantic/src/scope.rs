//! Scope analysis

use logos_core::{Position, Range, Symbol};

#[derive(Debug, Clone)]
pub struct Scope {
    pub id: usize,
    pub parent: Option<usize>,
    pub range: Range,
    pub name: Option<String>,
    pub children: Vec<usize>,
}

impl Scope {
    pub fn new(id: usize, range: Range) -> Self {
        Self { id, parent: None, range, name: None, children: Vec::new() }
    }

    pub fn with_parent(mut self, parent: usize) -> Self {
        self.parent = Some(parent);
        self
    }

    pub fn with_name(mut self, name: String) -> Self {
        self.name = Some(name);
        self
    }
}

#[derive(Debug, Default)]
pub struct ScopeTree {
    scopes: Vec<Scope>,
    root: Option<usize>,
}

impl ScopeTree {
    pub fn new() -> Self { Self::default() }

    pub fn from_symbols(symbols: &[Symbol]) -> Self {
        let mut tree = Self::new();
        if symbols.is_empty() { return tree; }

        let mut min_start = Position::new(u32::MAX, u32::MAX);
        let mut max_end = Position::new(0, 0);
        for symbol in symbols {
            if symbol.range.start < min_start { min_start = symbol.range.start; }
            if symbol.range.end > max_end { max_end = symbol.range.end; }
        }

        let root_range = Range::new(min_start, max_end);
        let root_id = tree.add_scope(Scope::new(0, root_range));
        tree.root = Some(root_id);
        tree.add_scopes_from_symbols(symbols, root_id);
        tree
    }

    fn add_scopes_from_symbols(&mut self, symbols: &[Symbol], parent_id: usize) {
        for symbol in symbols {
            if !symbol.children.is_empty() {
                let scope_id = self.add_scope(
                    Scope::new(self.scopes.len(), symbol.range)
                        .with_parent(parent_id)
                        .with_name(symbol.name.clone()),
                );
                self.scopes[parent_id].children.push(scope_id);
                self.add_scopes_from_symbols(&symbol.children, scope_id);
            }
        }
    }

    pub fn add_scope(&mut self, mut scope: Scope) -> usize {
        let id = self.scopes.len();
        scope.id = id;
        self.scopes.push(scope);
        id
    }

    pub fn get_scope(&self, id: usize) -> Option<&Scope> { self.scopes.get(id) }

    pub fn scope_at(&self, position: Position) -> Option<usize> {
        self.find_scope_at(self.root?, position)
    }

    fn find_scope_at(&self, scope_id: usize, position: Position) -> Option<usize> {
        let scope = self.get_scope(scope_id)?;
        if !scope.range.contains(position) { return None; }
        for &child_id in &scope.children {
            if let Some(inner) = self.find_scope_at(child_id, position) {
                return Some(inner);
            }
        }
        Some(scope_id)
    }

    pub fn root(&self) -> Option<usize> { self.root }
}
