//! Hover handler

use serde_json::{json, Value};
use logos_core::Position;

use crate::protocol::{TextDocumentPositionParams, RequestId, Response};
use crate::state::State;

/// Handle textDocument/hover
pub fn handle(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: TextDocumentPositionParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid hover params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;
    let position = Position::new(params.position.line, params.position.character);

    if let Some(symbol) = state.symbol_index.find_at_position(uri, position) {
        let hover = json!({
            "contents": {
                "kind": "markdown",
                "value": format!("**{}** ({})", symbol.name, format!("{:?}", symbol.kind))
            },
            "range": {
                "start": {
                    "line": symbol.selection_range.start.line,
                    "character": symbol.selection_range.start.column
                },
                "end": {
                    "line": symbol.selection_range.end.line,
                    "character": symbol.selection_range.end.column
                }
            }
        });
        return Response::success(id, hover);
    }

    Response::null_result(id)
}
