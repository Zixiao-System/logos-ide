//! Symbol handlers

use serde_json::{json, Value};

use crate::protocol::{DocumentSymbolParams, WorkspaceSymbolParams, RequestId, Response};
use crate::state::State;

/// Handle textDocument/documentSymbol
pub fn document_symbols(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: DocumentSymbolParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid documentSymbol params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;

    let symbols: Vec<_> = state.symbol_index.get_document_symbols(uri)
        .iter()
        .map(|s| {
            json!({
                "name": s.name,
                "kind": s.kind.to_monaco_kind(),
                "range": {
                    "start": {
                        "line": s.range.start.line,
                        "character": s.range.start.column
                    },
                    "end": {
                        "line": s.range.end.line,
                        "character": s.range.end.column
                    }
                },
                "selectionRange": {
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

    Response::success(id, json!(symbols))
}

/// Handle workspace/symbol
pub fn workspace_symbols(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: WorkspaceSymbolParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid workspaceSymbol params: {}", e),
            );
        }
    };

    let results: Vec<_> = state.symbol_index.search(&params.query)
        .iter()
        .map(|s| {
            json!({
                "name": s.name,
                "kind": s.kind.to_monaco_kind(),
                "location": {
                    "uri": s.uri,
                    "range": {
                        "start": {
                            "line": s.range.start.line,
                            "character": s.range.start.column
                        },
                        "end": {
                            "line": s.range.end.line,
                            "character": s.range.end.column
                        }
                    }
                }
            })
        })
        .collect();

    Response::success(id, json!(results))
}
