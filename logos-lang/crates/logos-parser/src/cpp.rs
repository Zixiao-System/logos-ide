//! C++-specific parsing and symbol extraction

use logos_core::{Range, Symbol, SymbolKind};
use tree_sitter::{Node, Tree};
use crate::node_to_range;

/// Extract symbols from a C++ AST
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
                if let Some((name, sel_range)) = find_function_name_info(&declarator, source) {
                    symbols.push(Symbol::new(
                        name,
                        SymbolKind::Function,
                        node_to_range(node),
                        sel_range,
                    ));
                }
            }
        }
        "class_specifier" => {
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
        "struct_specifier" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Struct,
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
        "namespace_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let mut symbol = Symbol::new(
                    name,
                    SymbolKind::Namespace,
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
        "template_declaration" => {
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    if child.kind() != "template_parameter_list" {
                        extract_symbols_from_node(&child, source, symbols);
                    }
                }
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
        _ => {
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    extract_symbols_from_node(&child, source, symbols);
                }
            }
        }
    }
}

fn find_function_name_info(node: &Node, source: &str) -> Option<(String, Range)> {
    match node.kind() {
        "identifier" | "field_identifier" | "destructor_name" => {
            Some((get_node_text(node, source), node_to_range(node)))
        }
        "qualified_identifier" => {
            for i in (0..node.named_child_count()).rev() {
                if let Some(child) = node.named_child(i) {
                    if child.kind() == "identifier" || child.kind() == "destructor_name" {
                        return Some((get_node_text(&child, source), node_to_range(&child)));
                    }
                }
            }
            None
        }
        "function_declarator" => {
            node.child_by_field_name("declarator")
                .and_then(|d| find_function_name_info(&d, source))
        }
        _ => {
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    if let Some(info) = find_function_name_info(&child, source) {
                        return Some(info);
                    }
                }
            }
            None
        }
    }
}

fn extract_class_members(node: &Node, source: &str, symbols: &mut Vec<Symbol>) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            match child.kind() {
                "function_definition" | "declaration" => {
                    if let Some(declarator) = child.child_by_field_name("declarator") {
                        if let Some((name, sel_range)) = find_function_name_info(&declarator, source) {
                            let kind = if child.kind() == "function_definition" {
                                SymbolKind::Method
                            } else if declarator.kind() == "function_declarator" {
                                SymbolKind::Method
                            } else {
                                SymbolKind::Field
                            };

                            symbols.push(Symbol::new(
                                name,
                                kind,
                                node_to_range(&child),
                                sel_range,
                            ));
                        }
                    }
                }
                "field_declaration" => {
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
                _ => {}
            }
        }
    }
}

fn find_identifier_info(node: &Node, source: &str) -> Option<(String, Range)> {
    if node.kind() == "identifier" || node.kind() == "field_identifier" {
        return Some((get_node_text(node, source), node_to_range(node)));
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

fn get_node_text(node: &Node, source: &str) -> String {
    source[node.byte_range()].to_string()
}

/// Get C++ keywords
pub fn get_keywords() -> &'static [&'static str] {
    &[
        "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand",
        "bitor", "bool", "break", "case", "catch", "char", "char8_t",
        "char16_t", "char32_t", "class", "compl", "concept", "const",
        "consteval", "constexpr", "constinit", "const_cast", "continue",
        "co_await", "co_return", "co_yield", "decltype", "default", "delete",
        "do", "double", "dynamic_cast", "else", "enum", "explicit", "export",
        "extern", "false", "float", "for", "friend", "goto", "if", "inline",
        "int", "long", "mutable", "namespace", "new", "noexcept", "not",
        "not_eq", "nullptr", "operator", "or", "or_eq", "private", "protected",
        "public", "register", "reinterpret_cast", "requires", "return",
        "short", "signed", "sizeof", "static", "static_assert", "static_cast",
        "struct", "switch", "template", "this", "thread_local", "throw",
        "true", "try", "typedef", "typeid", "typename", "union", "unsigned",
        "using", "virtual", "void", "volatile", "wchar_t", "while", "xor",
        "xor_eq",
    ]
}
