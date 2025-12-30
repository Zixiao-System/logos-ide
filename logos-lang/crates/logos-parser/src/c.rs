//! C-specific parsing and symbol extraction

use logos_core::{Symbol, SymbolKind};
use tree_sitter::{Node, Tree};
use crate::node_to_range;

/// Extract symbols from a C AST
pub fn extract_symbols(tree: &Tree, source: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let root = tree.root_node();
    extract_symbols_from_node(&root, source, &mut symbols);
    symbols
}

fn extract_symbols_from_node(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    match node.kind() {
        "function_definition" => {
            if let Some(declarator) = node.child_by_field_name("declarator") {
                if let Some((name, sel_range)) = find_identifier_info(&declarator, source) {
                    symbols.push(Symbol::new(
                        name,
                        SymbolKind::Function,
                        node_to_range(node),
                        sel_range,
                    ));
                }
            }
        }
        "declaration" => {
            if let Some(declarator) = node.child_by_field_name("declarator") {
                if let Some((name, sel_range)) = find_identifier_info(&declarator, source) {
                    symbols.push(Symbol::new(
                        name,
                        SymbolKind::Variable,
                        node_to_range(node),
                        sel_range,
                    ));
                }
            }
        }
        "struct_specifier" | "union_specifier" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let kind = if node.kind() == "struct_specifier" {
                    SymbolKind::Struct
                } else {
                    SymbolKind::Class
                };

                let mut symbol = Symbol::new(
                    name,
                    kind,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                if let Some(body) = node.child_by_field_name("body") {
                    let mut children = Vec::new();
                    extract_struct_fields(&body, source, &mut children);
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "enum_specifier" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Enum,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                if let Some(body) = node.child_by_field_name("body") {
                    let mut children = Vec::new();
                    extract_enum_values(&body, source, &mut children);
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "type_definition" => {
            // Find the typedef name
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    if child.kind() == "type_identifier" {
                        let name = get_node_text(&child, source);
                        symbols.push(Symbol::new(
                            name,
                            SymbolKind::Class,
                            node_to_range(node),
                            node_to_range(&child),
                        ));
                    }
                }
            }
        }
        "preproc_def" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                symbols.push(Symbol::new(
                    name,
                    SymbolKind::Constant,
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

fn find_identifier_info(node: &Node, source: &str) -> Option<(String, crate::Range)> {
    if node.kind() == "identifier" {
        return Some((get_node_text(node, source), crate::node_to_range(node)));
    }

    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            if let Some(info) = find_identifier_info(&child, source) {
                return Some(info);
            }
        }
    }

    None
}

fn extract_struct_fields(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            if child.kind() == "field_declaration" {
                if let Some(declarator) = child.child_by_field_name("declarator") {
                    if let Some((name, sel_range)) = find_identifier_info(&declarator, source) {
                        symbols.push(Symbol::new(
                            name,
                            SymbolKind::Field,
                            node_to_range(&child),
                            sel_range,
                        ));
                    }
                }
            }
        }
    }
}

fn extract_enum_values(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            if child.kind() == "enumerator" {
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

/// Get C keywords
pub fn get_keywords() -> &'static [&'static str] {
    &[
        "auto", "break", "case", "char", "const", "continue", "default", "do",
        "double", "else", "enum", "extern", "float", "for", "goto", "if",
        "inline", "int", "long", "register", "restrict", "return", "short",
        "signed", "sizeof", "static", "struct", "switch", "typedef", "union",
        "unsigned", "void", "volatile", "while", "_Alignas", "_Alignof",
        "_Atomic", "_Bool", "_Complex", "_Generic", "_Imaginary", "_Noreturn",
        "_Static_assert", "_Thread_local",
    ]
}
