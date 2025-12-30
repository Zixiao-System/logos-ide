//! Python-specific parsing and symbol extraction

use logos_core::{Symbol, SymbolKind};
use tree_sitter::{Node, Tree};
use crate::node_to_range;

/// Extract symbols from a Python AST
pub fn extract_symbols(tree: &Tree, source: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let root = tree.root_node();
    extract_symbols_from_node(&root, source, &mut symbols, None);
    symbols
}

fn extract_symbols_from_node(
    node: &Node,
    source: &str,
    symbols: &mut Vec<Symbol>,
    parent: Option<&str>,
) {
    match node.kind() {
        "function_definition" | "async_function_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);
                let kind = if parent.is_some() {
                    SymbolKind::Method
                } else {
                    SymbolKind::Function
                };

                let mut symbol = Symbol::new(
                    name.clone(),
                    kind,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                // Extract parameters for detail
                if let Some(params) = node.child_by_field_name("parameters") {
                    let params_text = get_node_text(&params, source);
                    symbol.detail = Some(params_text);
                }

                // Extract nested symbols
                if let Some(body) = node.child_by_field_name("body") {
                    let mut children = Vec::new();
                    extract_children(&body, source, &mut children, Some(&name));
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "class_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = get_node_text(&name_node, source);

                let mut symbol = Symbol::new(
                    name.clone(),
                    SymbolKind::Class,
                    node_to_range(node),
                    node_to_range(&name_node),
                );

                // Extract superclasses for detail
                if let Some(superclasses) = node.child_by_field_name("superclasses") {
                    let supers_text = get_node_text(&superclasses, source);
                    symbol.detail = Some(format!("({})", supers_text));
                }

                // Extract methods and nested classes
                if let Some(body) = node.child_by_field_name("body") {
                    let mut children = Vec::new();
                    extract_children(&body, source, &mut children, Some(&name));
                    symbol.children = children;
                }

                symbols.push(symbol);
            }
        }
        "decorated_definition" => {
            // Skip to the actual definition
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    if child.kind() != "decorator" {
                        extract_symbols_from_node(&child, source, symbols, parent);
                    }
                }
            }
        }
        "assignment" | "augmented_assignment" => {
            // Variable assignments at module/class level
            if parent.is_none() || parent.is_some() {
                if let Some(left) = node.child_by_field_name("left") {
                    if left.kind() == "identifier" {
                        let name = get_node_text(&left, source);
                        // Check if it's a constant (UPPER_CASE)
                        let kind = if name.chars().all(|c| c.is_uppercase() || c == '_') {
                            SymbolKind::Constant
                        } else {
                            SymbolKind::Variable
                        };

                        symbols.push(Symbol::new(
                            name,
                            kind,
                            node_to_range(node),
                            node_to_range(&left),
                        ));
                    }
                }
            }
        }
        _ => {
            // Recurse into children for other node types
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    extract_symbols_from_node(&child, source, symbols, parent);
                }
            }
        }
    }
}

fn extract_children(node: &Node, source: &str, symbols: &mut Vec<Symbol>, parent: Option<&str>) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            extract_symbols_from_node(&child, source, symbols, parent);
        }
    }
}

fn get_node_text<'a>(node: &Node, source: &'a str) -> String {
    source[node.byte_range()].to_string()
}

/// Get completion keywords for Python
pub fn get_keywords() -> &'static [&'static str] {
    &[
        "False", "None", "True", "and", "as", "assert", "async", "await",
        "break", "class", "continue", "def", "del", "elif", "else", "except",
        "finally", "for", "from", "global", "if", "import", "in", "is",
        "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
        "while", "with", "yield",
    ]
}

/// Get builtin functions for Python
pub fn get_builtins() -> &'static [&'static str] {
    &[
        "abs", "all", "any", "ascii", "bin", "bool", "breakpoint", "bytearray",
        "bytes", "callable", "chr", "classmethod", "compile", "complex",
        "delattr", "dict", "dir", "divmod", "enumerate", "eval", "exec",
        "filter", "float", "format", "frozenset", "getattr", "globals",
        "hasattr", "hash", "help", "hex", "id", "input", "int", "isinstance",
        "issubclass", "iter", "len", "list", "locals", "map", "max",
        "memoryview", "min", "next", "object", "oct", "open", "ord", "pow",
        "print", "property", "range", "repr", "reversed", "round", "set",
        "setattr", "slice", "sorted", "staticmethod", "str", "sum", "super",
        "tuple", "type", "vars", "zip",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LanguageParser;
    use crate::LanguageId;

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn test_extract_function() {
        let mut parser = LanguageParser::new();
        parser.set_language(LanguageId::Python).unwrap();

        let source = r#"
def hello(name: str) -> str:
    return f"Hello, {name}!"
"#;
        let tree = parser.parse(source, None).unwrap();
        let symbols = extract_symbols(&tree, source);

        assert_eq!(symbols.len(), 1);
        assert_eq!(symbols[0].name, "hello");
        assert_eq!(symbols[0].kind, SymbolKind::Function);
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn test_extract_class() {
        let mut parser = LanguageParser::new();
        parser.set_language(LanguageId::Python).unwrap();

        let source = r#"
class MyClass:
    def __init__(self):
        pass

    def method(self):
        pass
"#;
        let tree = parser.parse(source, None).unwrap();
        let symbols = extract_symbols(&tree, source);

        assert_eq!(symbols.len(), 1);
        assert_eq!(symbols[0].name, "MyClass");
        assert_eq!(symbols[0].kind, SymbolKind::Class);
        assert_eq!(symbols[0].children.len(), 2);
    }
}
