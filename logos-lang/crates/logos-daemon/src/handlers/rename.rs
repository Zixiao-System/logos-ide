//! Rename handler

use serde_json::{json, Value};
use std::collections::HashMap;
use logos_core::Position;

use crate::protocol::{TextDocumentPositionParams, RenameParams, RequestId, Response};
use crate::state::State;

/// Handle textDocument/prepareRename
pub fn prepare(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: TextDocumentPositionParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid prepareRename params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;
    let position = Position::new(params.position.line, params.position.character);

    if let Some(symbol) = state.symbol_index.find_at_position(uri, position) {
        let result = json!({
            "range": {
                "start": {
                    "line": symbol.selection_range.start.line,
                    "character": symbol.selection_range.start.column
                },
                "end": {
                    "line": symbol.selection_range.end.line,
                    "character": symbol.selection_range.end.column
                }
            },
            "placeholder": symbol.name
        });
        return Response::success(id, result);
    }

    Response::null_result(id)
}

/// Handle textDocument/rename
pub fn handle(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: RenameParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid rename params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;
    let position = Position::new(params.position.line, params.position.character);
    let new_name = &params.new_name;

    // Find the symbol at the given position
    let symbol = match state.symbol_index.find_at_position(uri, position) {
        Some(s) => s,
        None => return Response::null_result(id),
    };

    let old_name = symbol.name.clone();

    // Find all references to this symbol
    let references = state.symbol_index.search(&old_name);

    // Group edits by document URI
    let mut changes: HashMap<String, Vec<Value>> = HashMap::new();

    for s in references {
        let edit = json!({
            "range": {
                "start": {
                    "line": s.selection_range.start.line,
                    "character": s.selection_range.start.column
                },
                "end": {
                    "line": s.selection_range.end.line,
                    "character": s.selection_range.end.column
                }
            },
            "newText": new_name
        });
        changes.entry(s.uri.clone()).or_default().push(edit);
    }

    let workspace_edit = json!({
        "changes": changes
    });

    Response::success(id, workspace_edit)
}
