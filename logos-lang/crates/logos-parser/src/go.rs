//! Go-specific parsing and symbol extraction

use logos_core::{Symbol, SymbolKind};
use tree_sitter::{Node, Tree};
use crate::node_to_range;

/// Extract symbols from a Go AST
pub fn extract_symbols(tree: &Tree, source: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let root = tree.root_node();
    extract_symbols_from_node(&root, source, &mut symbols);
    symbols
}

fn extract_symbols_from_node(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    match node.kind() {
        "function_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Function,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                if let Some(params) = node.child_by_field_name("parameters") {
                    symbol.detail = Some(get_node_text(&params, source));
                }

                symbols.push(symbol);
            }
        }
        "method_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Method,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                if let Some(receiver) = node.child_by_field_name("receiver") {
                    symbol.detail = Some(format!("receiver: {}", get_node_text(&receiver, source)));
                }

                symbols.push(symbol);
            }
        }
        "type_declaration" => {
            for i in 0..node.named_child_count() {
                if let Some(spec) = node.named_child(i) {
                    if spec.kind() == "type_spec" {
                        if let Some(name_node) = spec.child_by_field_name("name") {
                            let name = get_node_text(&name_node, source);
                            let kind = if let Some(type_node) = spec.child_by_field_name("type") {
                                match type_node.kind() {
                                    "struct_type" => SymbolKind::Struct,
                                    "interface_type" => SymbolKind::Interface,
                                    _ => SymbolKind::Class,
                                }
                            } else {
                                SymbolKind::Class
                            };

                            let mut symbol = Symbol::new(
                                name,
                                kind,
                                node_to_range(&spec),
                                node_to_range(&name_node),
                            );

                            // Extract struct fields
                            if let Some(type_node) = spec.child_by_field_name("type") {
                                if type_node.kind() == "struct_type" {
                                    let mut children = Vec::new();
                                    extract_struct_fields(&type_node, source, &mut children);
                                    symbol.children = children;
                                }
                            }

                            symbols.push(symbol);
                        }
                    }
                }
            }
        }
        "const_declaration" | "var_declaration" => {
            let is_const = node.kind() == "const_declaration";
            for i in 0..node.named_child_count() {
                if let Some(spec) = node.named_child(i) {
                    if spec.kind() == "const_spec" || spec.kind() == "var_spec" {
                        if let Some(name_node) = spec.child_by_field_name("name") {
                            let name = get_node_text(&name_node, source);
                            let kind = if is_const {
                                SymbolKind::Constant
                            } else {
                                SymbolKind::Variable
                            };

                            symbols.push(Symbol::new(
                                name,
                                kind,
                                node_to_range(&spec),
                                node_to_range(&name_node),
                            ));
                        }
                    }
                }
            }
        }
        _ => {
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    extract_symbols_from_node(&child, source, symbols);
                }
            }
        }
    }
}

fn extract_struct_fields(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            if child.kind() == "field_declaration" {
                if let Some(name_node) = child.child_by_field_name("name") {
                    let name = get_node_text(&name_node, source);
                    let mut symbol = Symbol::new(
                        name,
                        SymbolKind::Field,
                        node_to_range(&child),
                        node_to_range(&name_node),
                    );

                    if let Some(type_node) = child.child_by_field_name("type") {
                        symbol.detail = Some(get_node_text(&type_node, source));
                    }

                    symbols.push(symbol);
                }
            }
        }
    }
}

fn get_node_text<'a>(node: &Node, source: &'a str) -> String {
    source[node.byte_range()].to_string()
}

/// Get Go keywords for completion
pub fn get_keywords() -> &'static [&'static str] {
    &[
        "break", "case", "chan", "const", "continue", "default", "defer",
        "else", "fallthrough", "for", "func", "go", "goto", "if", "import",
        "interface", "map", "package", "range", "return", "select", "struct",
        "switch", "type", "var",
    ]
}

/// Get Go builtin functions
pub fn get_builtins() -> &'static [&'static str] {
    &[
        "append", "cap", "clear", "close", "complex", "copy", "delete",
        "imag", "len", "make", "max", "min", "new", "panic", "print",
        "println", "real", "recover",
    ]
}
