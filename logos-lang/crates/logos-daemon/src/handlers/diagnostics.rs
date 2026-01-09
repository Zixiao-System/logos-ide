//! Diagnostics handler

use serde_json::{json, Value};

use crate::protocol::{DocumentSymbolParams, RequestId, Response};
use crate::state::State;

/// Handle textDocument/diagnostic
pub fn handle(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: DocumentSymbolParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid diagnostic params: {}", e),
            );
        }
    };

    let _uri = &params.text_document.uri;

    // For now, return empty diagnostics
    // Future: integrate with parser errors and semantic analysis
    Response::success(id, json!({
        "kind": "full",
        "items": []
    }))
}
