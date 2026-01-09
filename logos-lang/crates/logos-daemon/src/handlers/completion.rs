//! Completion handler

use serde_json::{json, Value};
use logos_core::SymbolKind;

use crate::protocol::{TextDocumentPositionParams, RequestId, Response};
use crate::state::State;

/// Handle textDocument/completion
pub fn handle(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: TextDocumentPositionParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid completion params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;

    let doc = match state.get_document(uri) {
        Some(d) => d,
        None => {
            return Response::success(id, json!({ "isIncomplete": false, "items": [] }));
        }
    };

    let mut completions = Vec::new();

    // Add keyword completions based on language
    let keywords = match doc.language_id.as_str() {
        "python" => logos_parser::python::get_keywords(),
        "go" => logos_parser::go::get_keywords(),
        "rust" => logos_parser::rust_lang::get_keywords(),
        "c" => logos_parser::c::get_keywords(),
        "cpp" => logos_parser::cpp::get_keywords(),
        "java" => logos_parser::java::get_keywords(),
        "javascript" => logos_parser::javascript::get_keywords(),
        "typescript" => logos_parser::typescript::get_keywords(),
        _ => &[],
    };

    for kw in keywords {
        completions.push(json!({
            "label": kw,
            "kind": 14, // Keyword
            "detail": "keyword"
        }));
    }

    // Add symbols from index
    for symbol in state.symbol_index.get_document_symbols(uri) {
        completions.push(json!({
            "label": symbol.name,
            "kind": symbol_kind_to_completion_kind(symbol.kind),
            "detail": format!("{:?}", symbol.kind)
        }));
    }

    Response::success(id, json!({
        "isIncomplete": false,
        "items": completions
    }))
}

fn symbol_kind_to_completion_kind(kind: SymbolKind) -> u32 {
    match kind {
        SymbolKind::Function | SymbolKind::Method => 3,  // Function
        SymbolKind::Class => 7,       // Class
        SymbolKind::Interface => 8,   // Interface
        SymbolKind::Variable => 6,    // Variable
        SymbolKind::Constant => 21,   // Constant
        SymbolKind::Enum => 13,       // Enum
        SymbolKind::Struct => 22,     // Struct
        SymbolKind::Module => 9,      // Module
        SymbolKind::Property | SymbolKind::Field => 10, // Property
        _ => 1,                       // Text
    }
}
