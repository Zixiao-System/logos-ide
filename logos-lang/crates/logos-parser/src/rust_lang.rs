//! Rust-specific parsing and symbol extraction

use logos_core::{Symbol, SymbolKind};
use tree_sitter::{Node, Tree};
use crate::node_to_range;

/// Extract symbols from a Rust AST
pub fn extract_symbols(tree: &Tree, source: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let root = tree.root_node();
    extract_symbols_from_node(&root, source, &mut symbols);
    symbols
}

fn extract_symbols_from_node(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    match node.kind() {
        "function_item" => {
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
        "struct_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Struct,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                // Extract fields
                if let Some(body) = node.child_by_field_name("body") {
                    let mut children = Vec::new();
                    extract_struct_fields(&body, source, &mut children);
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "enum_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Enum,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                // Extract variants
                if let Some(body) = node.child_by_field_name("body") {
                    let mut children = Vec::new();
                    extract_enum_variants(&body, source, &mut children);
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "trait_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                symbols.push(Symbol::new(
                    name,
                    SymbolKind::Interface,
                    node_to_range(node),
                    node_to_range(&name_node),
                ));
            }
        }
        "impl_item" => {
            // Extract methods from impl blocks
            if let Some(body) = node.child_by_field_name("body") {
                for i in 0..body.named_child_count() {
                    if let Some(child) = body.named_child(i) {
                        extract_symbols_from_node(&child, source, symbols);
                    }
                }
            }
        }
        "const_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Constant,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                if let Some(type_node) = node.child_by_field_name("type") {
                    symbol.detail = Some(get_node_text(&type_node, source));
                }

                symbols.push(symbol);
            }
        }
        "static_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                symbols.push(Symbol::new(
                    name,
                    SymbolKind::Variable,
                    node_to_range(node),
                    node_to_range(&name_node),
                ));
            }
        }
        "mod_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Module,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                if let Some(body) = node.child_by_field_name("body") {
                    let mut children = Vec::new();
                    for i in 0..body.named_child_count() {
                        if let Some(child) = body.named_child(i) {
                            extract_symbols_from_node(&child, source, &mut children);
                        }
                    }
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "type_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                symbols.push(Symbol::new(
                    name,
                    SymbolKind::Class,
                    node_to_range(node),
                    node_to_range(&name_node),
                ));
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

fn extract_enum_variants(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            if child.kind() == "enum_variant" {
                if let Some(name_node) = child.child_by_field_name("name") {
                    let name = get_node_text(&name_node, source);
                    symbols.push(Symbol::new(
                        name,
                        SymbolKind::EnumMember,
                        node_to_range(&child),
                        node_to_range(&name_node),
                    ));
                }
            }
        }
    }
}

fn get_node_text<'a>(node: &Node, source: &'a str) -> String {
    source[node.byte_range()].to_string()
}

/// Get Rust keywords for completion
pub fn get_keywords() -> &'static [&'static str] {
    &[
        "as", "async", "await", "break", "const", "continue", "crate", "dyn",
        "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in",
        "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
        "self", "Self", "static", "struct", "super", "trait", "true", "type",
        "unsafe", "use", "where", "while",
    ]
}
