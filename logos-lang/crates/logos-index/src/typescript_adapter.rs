//! TypeScript Language Adapter
//!
//! Implements the LanguageAdapter trait for TypeScript/JavaScript files.
//! Extracts symbols, imports, exports, and call relationships.

use crate::adapter::{
    AnalysisResult, CallInfo, ExportInfo, ImportInfo, ImportItem, LanguageAdapter,
    SymbolBuilder, TypeRelation, make_location,
};
use crate::symbol_table::{SymbolId, TypeInfo, Visibility};
use logos_core::{Position, Range, SymbolKind};
use std::path::Path;
use tree_sitter::{Node, Parser, Tree};

/// TypeScript/JavaScript language adapter
pub struct TypeScriptAdapter {
    parser: std::sync::Mutex<Parser>,
}

impl TypeScriptAdapter {
    pub fn new() -> Result<Self, String> {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_typescript::LANGUAGE_TSX.into())
            .map_err(|e| format!("Failed to set TypeScript language: {}", e))?;

        Ok(Self {
            parser: std::sync::Mutex::new(parser),
        })
    }

    fn parse(&self, source: &str) -> Option<Tree> {
        let mut parser = self.parser.lock().ok()?;
        parser.parse(source, None)
    }
}

impl Default for TypeScriptAdapter {
    fn default() -> Self {
        Self::new().expect("Failed to create TypeScript adapter")
    }
}

impl LanguageAdapter for TypeScriptAdapter {
    fn language_id(&self) -> &str {
        "typescript"
    }

    fn file_extensions(&self) -> &[&str] {
        &["ts", "tsx", "js", "jsx", "mts", "mjs", "cts", "cjs"]
    }

    fn analyze(&self, uri: &str, source: &str) -> AnalysisResult {
        let tree = match self.parse(source) {
            Some(t) => t,
            None => return AnalysisResult::default(),
        };

        let mut context = AnalysisContext {
            uri: uri.to_string(),
            source,
            result: AnalysisResult::default(),
            scope_stack: Vec::new(),
            is_exported: false,
        };

        analyze_node(&tree.root_node(), &mut context);

        context.result
    }

    fn resolve_import(&self, from_file: &Path, import_path: &str) -> Option<std::path::PathBuf> {
        // Skip node_modules imports
        if !import_path.starts_with('.') && !import_path.starts_with('/') {
            return None;
        }

        let parent = from_file.parent()?;
        let resolved = parent.join(import_path);

        // Try exact match first
        if resolved.exists() && resolved.is_file() {
            return Some(resolved);
        }

        // Try with extensions
        for ext in self.file_extensions() {
            let with_ext = resolved.with_extension(ext);
            if with_ext.exists() {
                return Some(with_ext);
            }
        }

        // Try index files
        for ext in self.file_extensions() {
            let index = resolved.join(format!("index.{}", ext));
            if index.exists() {
                return Some(index);
            }
        }

        None
    }
}

/// Context for analysis traversal
struct AnalysisContext<'a> {
    uri: String,
    source: &'a str,
    result: AnalysisResult,
    scope_stack: Vec<ScopeInfo>,
    is_exported: bool,
}

struct ScopeInfo {
    symbol_id: SymbolId,
    name: String,
}

impl<'a> AnalysisContext<'a> {
    fn current_scope(&self) -> Option<&ScopeInfo> {
        self.scope_stack.last()
    }

    fn qualified_name(&self, name: &str) -> String {
        if self.scope_stack.is_empty() {
            name.to_string()
        } else {
            let prefix: Vec<_> = self.scope_stack.iter().map(|s| s.name.as_str()).collect();
            format!("{}.{}", prefix.join("."), name)
        }
    }

    fn get_text(&self, node: &Node) -> String {
        self.source[node.byte_range()].to_string()
    }
}

fn analyze_node(node: &Node, ctx: &mut AnalysisContext) {
    match node.kind() {
        // Import statements
        "import_statement" => analyze_import(node, ctx),

        // Export statements
        "export_statement" => analyze_export(node, ctx),

        // Function declarations
        "function_declaration" => analyze_function(node, ctx, false),
        "generator_function_declaration" => analyze_function(node, ctx, false),

        // Class declarations
        "class_declaration" => analyze_class(node, ctx),

        // Interface declarations
        "interface_declaration" => analyze_interface(node, ctx),

        // Type alias
        "type_alias_declaration" => analyze_type_alias(node, ctx),

        // Enum
        "enum_declaration" => analyze_enum(node, ctx),

        // Variable declarations
        "variable_declaration" | "lexical_declaration" => analyze_variable(node, ctx),

        // Call expressions
        "call_expression" => analyze_call(node, ctx),
        "new_expression" => analyze_new_expression(node, ctx),

        // Recurse into other nodes
        _ => {
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    analyze_node(&child, ctx);
                }
            }
        }
    }
}

fn analyze_import(node: &Node, ctx: &mut AnalysisContext) {
    let mut import = ImportInfo {
        module_path: String::new(),
        items: Vec::new(),
        is_type_only: false,
        location: node_to_range(node),
    };

    // Check for type-only import
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            if ctx.get_text(&child) == "type" {
                import.is_type_only = true;
                break;
            }
        }
    }

    // Get source module
    if let Some(source) = node.child_by_field_name("source") {
        let text = ctx.get_text(&source);
        // Remove quotes
        import.module_path = text.trim_matches(|c| c == '"' || c == '\'').to_string();
    }

    // Get imported items
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            match child.kind() {
                "import_clause" => {
                    analyze_import_clause(&child, ctx, &mut import);
                }
                "namespace_import" => {
                    if let Some(name) = child.child_by_field_name("name") {
                        import.items.push(ImportItem {
                            name: "*".to_string(),
                            alias: Some(ctx.get_text(&name)),
                            is_type: import.is_type_only,
                        });
                    }
                }
                _ => {}
            }
        }
    }

    if !import.module_path.is_empty() {
        ctx.result.imports.push(import);
    }
}

fn analyze_import_clause(node: &Node, ctx: &mut AnalysisContext, import: &mut ImportInfo) {
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            match child.kind() {
                "identifier" => {
                    // Default import
                    import.items.push(ImportItem {
                        name: "default".to_string(),
                        alias: Some(ctx.get_text(&child)),
                        is_type: import.is_type_only,
                    });
                }
                "named_imports" => {
                    for j in 0..child.named_child_count() {
                        if let Some(spec) = child.named_child(j) {
                            if spec.kind() == "import_specifier" {
                                let name = spec
                                    .child_by_field_name("name")
                                    .map(|n| ctx.get_text(&n));
                                let alias = spec
                                    .child_by_field_name("alias")
                                    .map(|n| ctx.get_text(&n));

                                if let Some(name) = name {
                                    import.items.push(ImportItem {
                                        name,
                                        alias,
                                        is_type: import.is_type_only,
                                    });
                                }
                            }
                        }
                    }
                }
                "namespace_import" => {
                    if let Some(name) = child.child_by_field_name("name") {
                        import.items.push(ImportItem {
                            name: "*".to_string(),
                            alias: Some(ctx.get_text(&name)),
                            is_type: import.is_type_only,
                        });
                    }
                }
                _ => {}
            }
        }
    }
}

fn analyze_export(node: &Node, ctx: &mut AnalysisContext) {
    // Check for re-export (export from)
    if let Some(source) = node.child_by_field_name("source") {
        analyze_reexport(node, ctx, &source);
        return;
    }

    // Check for default export
    let is_default = node.children(&mut node.walk()).any(|c| ctx.get_text(&c) == "default");

    // Set export flag and analyze child declarations
    let was_exported = ctx.is_exported;
    ctx.is_exported = true;

    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            match child.kind() {
                "function_declaration" | "generator_function_declaration" => {
                    analyze_function(&child, ctx, is_default);
                }
                "class_declaration" => {
                    analyze_class(&child, ctx);
                    if is_default {
                        // Mark last symbol as default export
                        if let Some(sym) = ctx.result.symbols.last_mut() {
                            ctx.result.exports.push(ExportInfo {
                                name: sym.name.clone(),
                                original_name: None,
                                from_module: None,
                                is_type_only: false,
                                is_default: true,
                                location: node_to_range(node),
                            });
                        }
                    }
                }
                "interface_declaration" => analyze_interface(&child, ctx),
                "type_alias_declaration" => analyze_type_alias(&child, ctx),
                "enum_declaration" => analyze_enum(&child, ctx),
                "variable_declaration" | "lexical_declaration" => analyze_variable(&child, ctx),
                "export_clause" => analyze_export_clause(&child, ctx),
                _ => analyze_node(&child, ctx),
            }
        }
    }

    ctx.is_exported = was_exported;
}

fn analyze_reexport(node: &Node, ctx: &mut AnalysisContext, source: &Node) {
    let source_text = ctx.get_text(source);
    let from_module = source_text.trim_matches(|c| c == '"' || c == '\'').to_string();

    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            match child.kind() {
                "export_clause" => {
                    for j in 0..child.named_child_count() {
                        if let Some(spec) = child.named_child(j) {
                            if spec.kind() == "export_specifier" {
                                let name = spec
                                    .child_by_field_name("name")
                                    .map(|n| ctx.get_text(&n));
                                let alias = spec
                                    .child_by_field_name("alias")
                                    .map(|n| ctx.get_text(&n));

                                if let Some(original_name) = name {
                                    let export_name = alias.clone().unwrap_or_else(|| original_name.clone());
                                    ctx.result.exports.push(ExportInfo {
                                        name: export_name,
                                        original_name: if alias.is_some() { Some(original_name) } else { None },
                                        from_module: Some(from_module.clone()),
                                        is_type_only: false,
                                        is_default: false,
                                        location: node_to_range(&spec),
                                    });
                                }
                            }
                        }
                    }
                }
                "namespace_export" => {
                    // export * from 'module'
                    ctx.result.exports.push(ExportInfo {
                        name: "*".to_string(),
                        original_name: None,
                        from_module: Some(from_module.clone()),
                        is_type_only: false,
                        is_default: false,
                        location: node_to_range(node),
                    });
                }
                _ => {}
            }
        }
    }
}

fn analyze_export_clause(node: &Node, ctx: &mut AnalysisContext) {
    for i in 0..node.named_child_count() {
        if let Some(spec) = node.named_child(i) {
            if spec.kind() == "export_specifier" {
                let name = spec.child_by_field_name("name").map(|n| ctx.get_text(&n));
                let alias = spec.child_by_field_name("alias").map(|n| ctx.get_text(&n));

                if let Some(original_name) = name {
                    let export_name = alias.clone().unwrap_or_else(|| original_name.clone());
                    ctx.result.exports.push(ExportInfo {
                        name: export_name,
                        original_name: if alias.is_some() { Some(original_name) } else { None },
                        from_module: None,
                        is_type_only: false,
                        is_default: false,
                        location: node_to_range(&spec),
                    });
                }
            }
        }
    }
}

fn analyze_function(node: &Node, ctx: &mut AnalysisContext, is_default_export: bool) {
    let name_node = node.child_by_field_name("name");
    let name = name_node
        .map(|n| ctx.get_text(&n))
        .unwrap_or_else(|| "anonymous".to_string());

    let location = make_location(
        &ctx.uri,
        node_to_range(node),
        name_node.map(|n| node_to_range(&n)).unwrap_or_else(|| node_to_range(node)),
    );

    // Extract parameters for type info
    let params = node
        .child_by_field_name("parameters")
        .map(|p| ctx.get_text(&p))
        .unwrap_or_default();

    let return_type = node
        .child_by_field_name("return_type")
        .map(|r| ctx.get_text(&r));

    let type_info = TypeInfo {
        type_expr: format!("{} => {}", params, return_type.as_deref().unwrap_or("void")),
        nullable: false,
        type_params: extract_type_params(node, ctx),
        return_type: return_type.map(|r| Box::new(TypeInfo::simple(r))),
        param_types: Vec::new(), // TODO: extract individual param types
    };

    let symbol = SymbolBuilder::new(name.clone(), SymbolKind::Function, location)
        .type_info(type_info)
        .exported(ctx.is_exported)
        .qualified_name(ctx.qualified_name(&name))
        .visibility(if ctx.is_exported { Visibility::Public } else { Visibility::Private })
        .build();

    let symbol_id = symbol.id;
    ctx.result.symbols.push(symbol);

    // Add export info
    if ctx.is_exported {
        ctx.result.exports.push(ExportInfo {
            name: name.clone(),
            original_name: None,
            from_module: None,
            is_type_only: false,
            is_default: is_default_export,
            location: node_to_range(node),
        });
    }

    // Analyze function body
    if let Some(body) = node.child_by_field_name("body") {
        ctx.scope_stack.push(ScopeInfo {
            symbol_id,
            name: name.clone(),
        });
        analyze_node(&body, ctx);
        ctx.scope_stack.pop();
    }
}

fn analyze_class(node: &Node, ctx: &mut AnalysisContext) {
    let name_node = node.child_by_field_name("name");
    let name = name_node
        .map(|n| ctx.get_text(&n))
        .unwrap_or_else(|| "anonymous".to_string());

    let location = make_location(
        &ctx.uri,
        node_to_range(node),
        name_node.map(|n| node_to_range(&n)).unwrap_or_else(|| node_to_range(node)),
    );

    let symbol = SymbolBuilder::new(name.clone(), SymbolKind::Class, location)
        .exported(ctx.is_exported)
        .qualified_name(ctx.qualified_name(&name))
        .visibility(if ctx.is_exported { Visibility::Public } else { Visibility::Private })
        .build();

    let symbol_id = symbol.id;
    ctx.result.symbols.push(symbol);

    // Extract type relationships (extends, implements) - iterate through children
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            match child.kind() {
                "class_heritage" => {
                    analyze_class_heritage(&child, ctx, &name);
                }
                "extends_clause" => {
                    // Direct extends clause
                    for j in 0..child.named_child_count() {
                        if let Some(type_node) = child.named_child(j) {
                            let parent_name = ctx.get_text(&type_node);
                            ctx.result.type_relations.push(TypeRelation {
                                child_name: name.clone(),
                                parent_name,
                                is_implements: false,
                                location: node_to_range(&type_node),
                            });
                        }
                    }
                }
                "implements_clause" => {
                    for j in 0..child.named_child_count() {
                        if let Some(type_node) = child.named_child(j) {
                            let parent_name = ctx.get_text(&type_node);
                            ctx.result.type_relations.push(TypeRelation {
                                child_name: name.clone(),
                                parent_name,
                                is_implements: true,
                                location: node_to_range(&type_node),
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }

    // Add export if exported
    if ctx.is_exported {
        ctx.result.exports.push(ExportInfo {
            name: name.clone(),
            original_name: None,
            from_module: None,
            is_type_only: false,
            is_default: false,
            location: node_to_range(node),
        });
    }

    // Analyze class body
    if let Some(body) = node.child_by_field_name("body") {
        ctx.scope_stack.push(ScopeInfo {
            symbol_id,
            name: name.clone(),
        });
        analyze_class_body(&body, ctx);
        ctx.scope_stack.pop();
    }
}

fn analyze_class_heritage(node: &Node, ctx: &mut AnalysisContext, child_name: &str) {
    for i in 0..node.named_child_count() {
        if let Some(clause) = node.named_child(i) {
            let is_implements = clause.kind() == "implements_clause";

            for j in 0..clause.named_child_count() {
                if let Some(type_node) = clause.named_child(j) {
                    // Skip non-type nodes
                    if type_node.kind() == "," {
                        continue;
                    }
                    let parent_name = ctx.get_text(&type_node);
                    ctx.result.type_relations.push(TypeRelation {
                        child_name: child_name.to_string(),
                        parent_name,
                        is_implements,
                        location: node_to_range(&type_node),
                    });
                }
            }
        }
    }
}

fn analyze_class_body(node: &Node, ctx: &mut AnalysisContext) {
    for i in 0..node.named_child_count() {
        if let Some(member) = node.named_child(i) {
            match member.kind() {
                "method_definition" => analyze_method(&member, ctx),
                "public_field_definition" | "private_field_definition" => analyze_field(&member, ctx),
                "constructor_definition" => analyze_constructor(&member, ctx),
                _ => {}
            }
        }
    }
}

fn analyze_method(node: &Node, ctx: &mut AnalysisContext) {
    let name_node = node.child_by_field_name("name");
    let name = name_node
        .map(|n| ctx.get_text(&n))
        .unwrap_or_else(|| "method".to_string());

    let visibility = get_member_visibility(node, ctx);

    let location = make_location(
        &ctx.uri,
        node_to_range(node),
        name_node.map(|n| node_to_range(&n)).unwrap_or_else(|| node_to_range(node)),
    );

    let symbol = SymbolBuilder::new(name.clone(), SymbolKind::Method, location)
        .parent(ctx.current_scope().map(|s| s.symbol_id).unwrap_or(SymbolId(0)))
        .visibility(visibility)
        .qualified_name(ctx.qualified_name(&name))
        .build();

    let symbol_id = symbol.id;
    ctx.result.symbols.push(symbol);

    // Analyze method body
    if let Some(body) = node.child_by_field_name("body") {
        ctx.scope_stack.push(ScopeInfo {
            symbol_id,
            name: name.clone(),
        });
        analyze_node(&body, ctx);
        ctx.scope_stack.pop();
    }
}

fn analyze_constructor(node: &Node, ctx: &mut AnalysisContext) {
    let location = make_location(&ctx.uri, node_to_range(node), node_to_range(node));

    let symbol = SymbolBuilder::new("constructor", SymbolKind::Constructor, location)
        .parent(ctx.current_scope().map(|s| s.symbol_id).unwrap_or(SymbolId(0)))
        .visibility(Visibility::Public)
        .qualified_name(ctx.qualified_name("constructor"))
        .build();

    let symbol_id = symbol.id;
    ctx.result.symbols.push(symbol);

    if let Some(body) = node.child_by_field_name("body") {
        ctx.scope_stack.push(ScopeInfo {
            symbol_id,
            name: "constructor".to_string(),
        });
        analyze_node(&body, ctx);
        ctx.scope_stack.pop();
    }
}

fn analyze_field(node: &Node, ctx: &mut AnalysisContext) {
    let name_node = node.child_by_field_name("name");
    let name = name_node
        .map(|n| ctx.get_text(&n))
        .unwrap_or_else(|| "field".to_string());

    let visibility = if node.kind() == "private_field_definition" {
        Visibility::Private
    } else {
        get_member_visibility(node, ctx)
    };

    let location = make_location(
        &ctx.uri,
        node_to_range(node),
        name_node.map(|n| node_to_range(&n)).unwrap_or_else(|| node_to_range(node)),
    );

    let type_info = node
        .child_by_field_name("type")
        .map(|t| TypeInfo::simple(ctx.get_text(&t)));

    let mut builder = SymbolBuilder::new(name.clone(), SymbolKind::Property, location)
        .parent(ctx.current_scope().map(|s| s.symbol_id).unwrap_or(SymbolId(0)))
        .visibility(visibility)
        .qualified_name(ctx.qualified_name(&name));

    if let Some(ti) = type_info {
        builder = builder.type_info(ti);
    }

    ctx.result.symbols.push(builder.build());
}

fn analyze_interface(node: &Node, ctx: &mut AnalysisContext) {
    let name_node = node.child_by_field_name("name");
    let name = name_node
        .map(|n| ctx.get_text(&n))
        .unwrap_or_else(|| "Interface".to_string());

    let location = make_location(
        &ctx.uri,
        node_to_range(node),
        name_node.map(|n| node_to_range(&n)).unwrap_or_else(|| node_to_range(node)),
    );

    let symbol = SymbolBuilder::new(name.clone(), SymbolKind::Interface, location)
        .exported(ctx.is_exported)
        .qualified_name(ctx.qualified_name(&name))
        .visibility(if ctx.is_exported { Visibility::Public } else { Visibility::Private })
        .build();

    let symbol_id = symbol.id;
    ctx.result.symbols.push(symbol);

    // Check for extends - iterate through all children
    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            if child.kind() == "extends_type_clause" || child.kind() == "extends_clause" {
                for j in 0..child.named_child_count() {
                    if let Some(type_node) = child.named_child(j) {
                        // Get the type identifier
                        let parent_name = extract_type_name(&type_node, ctx);
                        if !parent_name.is_empty() {
                            ctx.result.type_relations.push(TypeRelation {
                                child_name: name.clone(),
                                parent_name,
                                is_implements: false,
                                location: node_to_range(&type_node),
                            });
                        }
                    }
                }
            }
        }
    }

    // Add export
    if ctx.is_exported {
        ctx.result.exports.push(ExportInfo {
            name: name.clone(),
            original_name: None,
            from_module: None,
            is_type_only: true,
            is_default: false,
            location: node_to_range(node),
        });
    }

    // Analyze interface body
    if let Some(body) = node.child_by_field_name("body") {
        ctx.scope_stack.push(ScopeInfo { symbol_id, name });
        analyze_interface_body(&body, ctx);
        ctx.scope_stack.pop();
    }
}

/// Extract the type name from a type node (handles generic types, etc.)
fn extract_type_name(node: &Node, ctx: &AnalysisContext) -> String {
    match node.kind() {
        "type_identifier" | "identifier" => ctx.get_text(node),
        "generic_type" => {
            // Get just the base type name
            if let Some(name_node) = node.child_by_field_name("name") {
                ctx.get_text(&name_node)
            } else if let Some(first) = node.named_child(0) {
                ctx.get_text(&first)
            } else {
                ctx.get_text(node)
            }
        }
        _ => ctx.get_text(node),
    }
}

fn analyze_interface_body(node: &Node, ctx: &mut AnalysisContext) {
    for i in 0..node.named_child_count() {
        if let Some(member) = node.named_child(i) {
            match member.kind() {
                "method_signature" => {
                    if let Some(name_node) = member.child_by_field_name("name") {
                        let name = ctx.get_text(&name_node);
                        let location = make_location(&ctx.uri, node_to_range(&member), node_to_range(&name_node));

                        let symbol = SymbolBuilder::new(name.clone(), SymbolKind::Method, location)
                            .parent(ctx.current_scope().map(|s| s.symbol_id).unwrap_or(SymbolId(0)))
                            .visibility(Visibility::Public)
                            .qualified_name(ctx.qualified_name(&name))
                            .build();

                        ctx.result.symbols.push(symbol);
                    }
                }
                "property_signature" => {
                    if let Some(name_node) = member.child_by_field_name("name") {
                        let name = ctx.get_text(&name_node);
                        let location = make_location(&ctx.uri, node_to_range(&member), node_to_range(&name_node));

                        let type_info = member
                            .child_by_field_name("type")
                            .map(|t| TypeInfo::simple(ctx.get_text(&t)));

                        let mut builder = SymbolBuilder::new(name.clone(), SymbolKind::Property, location)
                            .parent(ctx.current_scope().map(|s| s.symbol_id).unwrap_or(SymbolId(0)))
                            .visibility(Visibility::Public)
                            .qualified_name(ctx.qualified_name(&name));

                        if let Some(ti) = type_info {
                            builder = builder.type_info(ti);
                        }

                        ctx.result.symbols.push(builder.build());
                    }
                }
                _ => {}
            }
        }
    }
}

fn analyze_type_alias(node: &Node, ctx: &mut AnalysisContext) {
    let name_node = node.child_by_field_name("name");
    let name = name_node
        .map(|n| ctx.get_text(&n))
        .unwrap_or_else(|| "Type".to_string());

    let location = make_location(
        &ctx.uri,
        node_to_range(node),
        name_node.map(|n| node_to_range(&n)).unwrap_or_else(|| node_to_range(node)),
    );

    let type_value = node
        .child_by_field_name("value")
        .map(|v| TypeInfo::simple(ctx.get_text(&v)));

    let mut builder = SymbolBuilder::new(name.clone(), SymbolKind::Class, location)
        .exported(ctx.is_exported)
        .qualified_name(ctx.qualified_name(&name))
        .visibility(if ctx.is_exported { Visibility::Public } else { Visibility::Private });

    if let Some(ti) = type_value {
        builder = builder.type_info(ti);
    }

    ctx.result.symbols.push(builder.build());

    if ctx.is_exported {
        ctx.result.exports.push(ExportInfo {
            name,
            original_name: None,
            from_module: None,
            is_type_only: true,
            is_default: false,
            location: node_to_range(node),
        });
    }
}

fn analyze_enum(node: &Node, ctx: &mut AnalysisContext) {
    let name_node = node.child_by_field_name("name");
    let name = name_node
        .map(|n| ctx.get_text(&n))
        .unwrap_or_else(|| "Enum".to_string());

    let location = make_location(
        &ctx.uri,
        node_to_range(node),
        name_node.map(|n| node_to_range(&n)).unwrap_or_else(|| node_to_range(node)),
    );

    let symbol = SymbolBuilder::new(name.clone(), SymbolKind::Enum, location)
        .exported(ctx.is_exported)
        .qualified_name(ctx.qualified_name(&name))
        .visibility(if ctx.is_exported { Visibility::Public } else { Visibility::Private })
        .build();

    let symbol_id = symbol.id;
    ctx.result.symbols.push(symbol);

    if ctx.is_exported {
        ctx.result.exports.push(ExportInfo {
            name: name.clone(),
            original_name: None,
            from_module: None,
            is_type_only: false,
            is_default: false,
            location: node_to_range(node),
        });
    }

    // Analyze enum members
    if let Some(body) = node.child_by_field_name("body") {
        ctx.scope_stack.push(ScopeInfo { symbol_id, name });
        for i in 0..body.named_child_count() {
            if let Some(member) = body.named_child(i) {
                if member.kind() == "enum_assignment" || member.kind() == "property_identifier" {
                    let member_name = if member.kind() == "enum_assignment" {
                        member.child_by_field_name("name").map(|n| ctx.get_text(&n))
                    } else {
                        Some(ctx.get_text(&member))
                    };

                    if let Some(name) = member_name {
                        let location = make_location(&ctx.uri, node_to_range(&member), node_to_range(&member));
                        let symbol = SymbolBuilder::new(name.clone(), SymbolKind::EnumMember, location)
                            .parent(ctx.current_scope().map(|s| s.symbol_id).unwrap_or(SymbolId(0)))
                            .visibility(Visibility::Public)
                            .qualified_name(ctx.qualified_name(&name))
                            .build();
                        ctx.result.symbols.push(symbol);
                    }
                }
            }
        }
        ctx.scope_stack.pop();
    }
}

fn analyze_variable(node: &Node, ctx: &mut AnalysisContext) {
    let is_const = node.child(0).map(|c| ctx.get_text(&c) == "const").unwrap_or(false);

    for i in 0..node.named_child_count() {
        if let Some(declarator) = node.named_child(i) {
            if declarator.kind() == "variable_declarator" {
                let name_node = declarator.child_by_field_name("name");
                let name = name_node
                    .map(|n| ctx.get_text(&n))
                    .unwrap_or_else(|| "var".to_string());

                // Determine kind based on value
                let kind = declarator.child_by_field_name("value").map(|v| {
                    match v.kind() {
                        "arrow_function" | "function_expression" => SymbolKind::Function,
                        "class" => SymbolKind::Class,
                        _ if is_const => SymbolKind::Constant,
                        _ => SymbolKind::Variable,
                    }
                }).unwrap_or(if is_const { SymbolKind::Constant } else { SymbolKind::Variable });

                let location = make_location(
                    &ctx.uri,
                    node_to_range(node),
                    name_node.map(|n| node_to_range(&n)).unwrap_or_else(|| node_to_range(node)),
                );

                let type_info = declarator
                    .child_by_field_name("type")
                    .map(|t| TypeInfo::simple(ctx.get_text(&t)));

                let mut builder = SymbolBuilder::new(name.clone(), kind, location)
                    .exported(ctx.is_exported)
                    .qualified_name(ctx.qualified_name(&name))
                    .visibility(if ctx.is_exported { Visibility::Public } else { Visibility::Private });

                if let Some(ti) = type_info {
                    builder = builder.type_info(ti);
                }

                let symbol = builder.build();
                let symbol_id = symbol.id;
                ctx.result.symbols.push(symbol);

                if ctx.is_exported {
                    ctx.result.exports.push(ExportInfo {
                        name: name.clone(),
                        original_name: None,
                        from_module: None,
                        is_type_only: false,
                        is_default: false,
                        location: node_to_range(node),
                    });
                }

                // If it's a function, analyze the body
                if kind == SymbolKind::Function {
                    if let Some(value) = declarator.child_by_field_name("value") {
                        if let Some(body) = value.child_by_field_name("body") {
                            ctx.scope_stack.push(ScopeInfo { symbol_id, name });
                            analyze_node(&body, ctx);
                            ctx.scope_stack.pop();
                        }
                    }
                }
            }
        }
    }
}

fn analyze_call(node: &Node, ctx: &mut AnalysisContext) {
    if let Some(function) = node.child_by_field_name("function") {
        let (callee_name, qualified_name) = match function.kind() {
            "identifier" => {
                let name = ctx.get_text(&function);
                (name.clone(), None)
            }
            "member_expression" => {
                if let Some(property) = function.child_by_field_name("property") {
                    let prop_name = ctx.get_text(&property);
                    let full_name = ctx.get_text(&function);
                    (prop_name, Some(full_name))
                } else {
                    return;
                }
            }
            _ => return,
        };

        ctx.result.calls.push(CallInfo {
            callee_name,
            qualified_name,
            location: node_to_range(node),
            is_constructor: false,
        });
    }

    // Recurse into arguments for nested calls
    if let Some(args) = node.child_by_field_name("arguments") {
        analyze_node(&args, ctx);
    }
}

fn analyze_new_expression(node: &Node, ctx: &mut AnalysisContext) {
    if let Some(constructor) = node.child_by_field_name("constructor") {
        let callee_name = ctx.get_text(&constructor);

        ctx.result.calls.push(CallInfo {
            callee_name: callee_name.clone(),
            qualified_name: Some(format!("new {}", callee_name)),
            location: node_to_range(node),
            is_constructor: true,
        });
    }

    // Recurse into arguments
    if let Some(args) = node.child_by_field_name("arguments") {
        analyze_node(&args, ctx);
    }
}

fn get_member_visibility(node: &Node, ctx: &AnalysisContext) -> Visibility {
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            let text = ctx.get_text(&child);
            match text.as_str() {
                "public" => return Visibility::Public,
                "protected" => return Visibility::Protected,
                "private" => return Visibility::Private,
                _ => {}
            }
        }
    }
    Visibility::Public
}

fn extract_type_params(node: &Node, ctx: &AnalysisContext) -> Vec<String> {
    let mut params = Vec::new();
    if let Some(type_params) = node.child_by_field_name("type_parameters") {
        for i in 0..type_params.named_child_count() {
            if let Some(param) = type_params.named_child(i) {
                if let Some(name) = param.child_by_field_name("name") {
                    params.push(ctx.get_text(&name));
                }
            }
        }
    }
    params
}

fn node_to_range(node: &Node) -> Range {
    let start = node.start_position();
    let end = node.end_position();
    Range {
        start: Position {
            line: start.row as u32,
            column: start.column as u32,
        },
        end: Position {
            line: end.row as u32,
            column: end.column as u32,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_function() {
        let adapter = TypeScriptAdapter::new().unwrap();
        let source = r#"
export function greet(name: string): string {
    return `Hello, ${name}!`;
}
"#;
        let result = adapter.analyze("file:///test.ts", source);

        assert_eq!(result.symbols.len(), 1);
        assert_eq!(result.symbols[0].name, "greet");
        assert_eq!(result.symbols[0].kind, SymbolKind::Function);
        assert!(result.symbols[0].exported);

        assert_eq!(result.exports.len(), 1);
        assert_eq!(result.exports[0].name, "greet");
    }

    #[test]
    fn test_class_with_members() {
        let adapter = TypeScriptAdapter::new().unwrap();
        let source = r#"
export class User {
    private name: string;

    constructor(name: string) {
        this.name = name;
    }

    public greet(): string {
        return `Hello, ${this.name}!`;
    }
}
"#;
        let result = adapter.analyze("file:///test.ts", source);

        // Should have: User class, name field, constructor, greet method
        assert!(result.symbols.len() >= 4);

        let class_sym = result.symbols.iter().find(|s| s.name == "User").unwrap();
        assert_eq!(class_sym.kind, SymbolKind::Class);
        assert!(class_sym.exported);

        let name_sym = result.symbols.iter().find(|s| s.name == "name").unwrap();
        assert_eq!(name_sym.visibility, Visibility::Private);

        let greet_sym = result.symbols.iter().find(|s| s.name == "greet").unwrap();
        assert_eq!(greet_sym.visibility, Visibility::Public);
    }

    #[test]
    fn test_imports() {
        let adapter = TypeScriptAdapter::new().unwrap();
        let source = r#"
import { useState, useEffect } from 'react';
import type { FC } from 'react';
import * as fs from 'fs';
import path from 'path';
"#;
        let result = adapter.analyze("file:///test.ts", source);

        assert_eq!(result.imports.len(), 4);

        let react_import = result.imports.iter().find(|i| i.module_path == "react" && !i.is_type_only).unwrap();
        assert_eq!(react_import.items.len(), 2);

        let type_import = result.imports.iter().find(|i| i.is_type_only).unwrap();
        assert!(type_import.is_type_only);
    }

    #[test]
    fn test_interface_extends() {
        let adapter = TypeScriptAdapter::new().unwrap();
        let source = r#"
interface Animal {
    name: string;
}

interface Dog extends Animal {
    breed: string;
}

class Labrador implements Dog {
    name: string = '';
    breed: string = 'Labrador';
}
"#;
        let result = adapter.analyze("file:///test.ts", source);

        // Check type relations
        let dog_extends = result.type_relations.iter()
            .find(|r| r.child_name == "Dog" && r.parent_name == "Animal")
            .expect("Dog should extend Animal");
        assert!(!dog_extends.is_implements);

        let lab_implements = result.type_relations.iter()
            .find(|r| r.child_name == "Labrador" && r.parent_name == "Dog")
            .expect("Labrador should implement Dog");
        assert!(lab_implements.is_implements);
    }
}
