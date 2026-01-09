//! References handler

use serde_json::{json, Value};
use logos_core::Position;

use crate::protocol::{TextDocumentPositionParams, RequestId, Response};
use crate::state::State;

/// Handle textDocument/references
pub fn handle(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: TextDocumentPositionParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid references params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;
    let position = Position::new(params.position.line, params.position.character);

    // Find the symbol at the given position
    let symbol = match state.symbol_index.find_at_position(uri, position) {
        Some(s) => s,
        None => return Response::success(id, json!([])),
    };

    let symbol_name = symbol.name.clone();

    // Search for all occurrences of this symbol name
    let references: Vec<_> = state.symbol_index.search(&symbol_name)
        .iter()
        .map(|s| {
            json!({
                "uri": s.uri,
                "range": {
                    "start": {
                        "line": s.selection_range.start.line,
                        "character": s.selection_range.start.column
                    },
                    "end": {
                        "line": s.selection_range.end.line,
                        "character": s.selection_range.end.column
                    }
                }
            })
        })
        .collect();

    Response::success(id, json!(references))
}
