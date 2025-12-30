//! TypeScript-specific parsing and symbol extraction

use logos_core::{Symbol, SymbolKind};
use tree_sitter::{Node, Tree};
use crate::node_to_range;

/// Extract symbols from a TypeScript AST
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
        "class_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Class,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                if let Some(body) = node.child_by_field_name("body") {
                    let mut children = Vec::new();
                    extract_class_members(&body, source, &mut children);
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "interface_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Interface,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                if let Some(body) = node.child_by_field_name("body") {
                    let mut children = Vec::new();
                    extract_interface_members(&body, source, &mut children);
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "type_alias_declaration" => {
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
        "enum_declaration" => {
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
                    extract_enum_members(&body, source, &mut children);
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "method_definition" | "method_signature" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let kind = if name == "constructor" {
                    SymbolKind::Constructor
                } else {
                    SymbolKind::Method
                };

                symbols.push(Symbol::new(
                    name,
                    kind,
                    node_to_range(node),
                    node_to_range(&name_node),
                ));
            }
        }
        "public_field_definition" | "property_signature" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                symbols.push(Symbol::new(
                    name,
                    SymbolKind::Property,
                    node_to_range(node),
                    node_to_range(&name_node),
                ));
            }
        }
        "variable_declaration" | "lexical_declaration" => {
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    if child.kind() == "variable_declarator" {
                        if let Some(name_node) = child.child_by_field_name("name") {
                            let name = get_node_text(&name_node, source);
                            let kind = if node.kind() == "lexical_declaration" {
                                if let Some(first_child) = node.child(0) {
                                    if get_node_text(&first_child, source) == "const" {
                                        SymbolKind::Constant
                                    } else {
                                        SymbolKind::Variable
                                    }
                                } else {
                                    SymbolKind::Variable
                                }
                            } else {
                                SymbolKind::Variable
                            };

                            let actual_kind = if let Some(value) = child.child_by_field_name("value") {
                                match value.kind() {
                                    "arrow_function" | "function_expression" => SymbolKind::Function,
                                    "class" => SymbolKind::Class,
                                    _ => kind,
                                }
                            } else {
                                kind
                            };

                            symbols.push(Symbol::new(
                                name,
                                actual_kind,
                                node_to_range(node),
                                node_to_range(&name_node),
                            ));
                        }
                    }
                }
            }
        }
        "export_statement" | "ambient_declaration" => {
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    extract_symbols_from_node(&child, source, symbols);
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

fn extract_class_members(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            extract_symbols_from_node(&child, source, symbols);
        }
    }
}

fn extract_interface_members(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            extract_symbols_from_node(&child, source, symbols);
        }
    }
}

fn extract_enum_members(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            if child.kind() == "enum_assignment" || child.kind() == "property_identifier" {
                let name_node = if child.kind() == "enum_assignment" {
                    child.child_by_field_name("name")
                } else {
                    Some(child)
                };

                if let Some(name_node) = name_node {
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

/// Get TypeScript keywords (extends JavaScript keywords)
pub fn get_keywords() -> &'static [&'static str] {
    &[
        // JavaScript keywords
        "await", "break", "case", "catch", "class", "const", "continue",
        "debugger", "default", "delete", "do", "else", "enum", "export",
        "extends", "false", "finally", "for", "function", "if", "import",
        "in", "instanceof", "let", "new", "null", "return", "super",
        "switch", "this", "throw", "true", "try", "typeof", "undefined",
        "var", "void", "while", "with", "yield", "async", "of", "static",
        "get", "set",
        // TypeScript specific
        "abstract", "any", "as", "asserts", "bigint", "boolean", "declare",
        "implements", "interface", "is", "keyof", "module", "namespace",
        "never", "number", "object", "private", "protected", "public",
        "readonly", "require", "string", "symbol", "type", "unique",
        "unknown", "infer", "satisfies",
    ]
}

/// Get TypeScript type keywords
pub fn get_type_keywords() -> &'static [&'static str] {
    &[
        "any", "boolean", "bigint", "never", "null", "number", "object",
        "string", "symbol", "undefined", "unknown", "void",
    ]
}
