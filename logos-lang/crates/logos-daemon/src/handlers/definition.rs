//! Definition handler

use serde_json::{json, Value};
use logos_core::Position;

use crate::protocol::{TextDocumentPositionParams, RequestId, Response};
use crate::state::State;

/// Handle textDocument/definition
pub fn handle(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: TextDocumentPositionParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid definition params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;
    let position = Position::new(params.position.line, params.position.character);

    if let Some(symbol) = state.symbol_index.find_at_position(uri, position) {
        let definition = json!({
            "uri": symbol.uri,
            "range": {
                "start": {
                    "line": symbol.range.start.line,
                    "character": symbol.range.start.column
                },
                "end": {
                    "line": symbol.range.end.line,
                    "character": symbol.range.end.column
                }
            }
        });
        return Response::success(id, definition);
    }

    Response::null_result(id)
}
