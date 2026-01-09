//! Refactoring handlers

use serde_json::{json, Value};

use crate::protocol::{RefactorParams, ExtractVariableParams, ExtractMethodParams, RequestId, Response};
use crate::state::State;

/// Handle logos/getRefactorActions
pub fn get_actions(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: RefactorParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid refactor params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;

    let doc = match state.get_document(uri) {
        Some(d) => d,
        None => return Response::success(id, json!([])),
    };

    let language = match logos_parser::LanguageId::from_str(&doc.language_id) {
        Some(l) => l,
        None => return Response::success(id, json!([])),
    };

    let selection = logos_core::Range::from_coords(
        params.range.start.line,
        params.range.start.character,
        params.range.end.line,
        params.range.end.character,
    );

    let ctx = logos_refactor::RefactorContext::new(doc.content(), uri, selection, language);
    let actions = logos_refactor::RefactorEngine::get_actions(&ctx);

    let result: Vec<_> = actions.iter().map(|action| {
        json!({
            "id": action.id,
            "title": action.title,
            "kind": format!("{:?}", action.kind),
            "isAvailable": action.is_available,
            "unavailableReason": action.unavailable_reason
        })
    }).collect();

    Response::success(id, json!(result))
}

/// Handle logos/extractVariable
pub fn extract_variable(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: ExtractVariableParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid extractVariable params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;

    let doc = match state.get_document(uri) {
        Some(d) => d,
        None => {
            return Response::success(id, json!({"success": false, "error": "Document not found"}));
        }
    };

    let language = match logos_parser::LanguageId::from_str(&doc.language_id) {
        Some(l) => l,
        None => {
            return Response::success(id, json!({"success": false, "error": "Unsupported language"}));
        }
    };

    let selection = logos_core::Range::from_coords(
        params.range.start.line,
        params.range.start.character,
        params.range.end.line,
        params.range.end.character,
    );

    let ctx = logos_refactor::RefactorContext::new(doc.content(), uri, selection, language);

    match logos_refactor::extract_variable::extract(&ctx, &params.variable_name) {
        Ok(result) => {
            let edits: Vec<_> = result.edits.iter().map(|edit| {
                json!({
                    "range": {
                        "start": {
                            "line": edit.range.start.line,
                            "character": edit.range.start.column
                        },
                        "end": {
                            "line": edit.range.end.line,
                            "character": edit.range.end.column
                        }
                    },
                    "newText": edit.new_text
                })
            }).collect();

            Response::success(id, json!({
                "success": true,
                "edits": edits,
                "description": result.description,
                "generatedCode": result.generated_code
            }))
        }
        Err(e) => {
            Response::success(id, json!({
                "success": false,
                "error": e.to_string()
            }))
        }
    }
}

/// Handle logos/extractMethod
pub fn extract_method(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: ExtractMethodParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid extractMethod params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;

    let doc = match state.get_document(uri) {
        Some(d) => d,
        None => {
            return Response::success(id, json!({"success": false, "error": "Document not found"}));
        }
    };

    let language = match logos_parser::LanguageId::from_str(&doc.language_id) {
        Some(l) => l,
        None => {
            return Response::success(id, json!({"success": false, "error": "Unsupported language"}));
        }
    };

    let selection = logos_core::Range::from_coords(
        params.range.start.line,
        params.range.start.character,
        params.range.end.line,
        params.range.end.character,
    );

    let ctx = logos_refactor::RefactorContext::new(doc.content(), uri, selection, language);

    match logos_refactor::extract_method::extract(&ctx, &params.method_name) {
        Ok(result) => {
            let edits: Vec<_> = result.edits.iter().map(|edit| {
                json!({
                    "range": {
                        "start": {
                            "line": edit.range.start.line,
                            "character": edit.range.start.column
                        },
                        "end": {
                            "line": edit.range.end.line,
                            "character": edit.range.end.column
                        }
                    },
                    "newText": edit.new_text
                })
            }).collect();

            Response::success(id, json!({
                "success": true,
                "edits": edits,
                "description": result.description,
                "generatedCode": result.generated_code
            }))
        }
        Err(e) => {
            Response::success(id, json!({
                "success": false,
                "error": e.to_string()
            }))
        }
    }
}

/// Handle logos/canSafeDelete
pub fn can_safe_delete(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: RefactorParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid canSafeDelete params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;

    let doc = match state.get_document(uri) {
        Some(d) => d,
        None => {
            return Response::success(id, json!({"canDelete": false, "error": "Document not found"}));
        }
    };

    let language = match logos_parser::LanguageId::from_str(&doc.language_id) {
        Some(l) => l,
        None => {
            return Response::success(id, json!({"canDelete": false, "error": "Unsupported language"}));
        }
    };

    let selection = logos_core::Range::from_coords(
        params.range.start.line,
        params.range.start.character,
        params.range.end.line,
        params.range.end.character,
    );

    let ctx = logos_refactor::RefactorContext::new(doc.content(), uri, selection, language);

    match logos_refactor::safe_delete::analyze(&ctx) {
        Ok(analysis) => {
            let usages: Vec<_> = analysis.usages.iter().map(|loc| {
                json!({
                    "uri": loc.uri,
                    "range": {
                        "start": {
                            "line": loc.range.start.line,
                            "character": loc.range.start.column
                        },
                        "end": {
                            "line": loc.range.end.line,
                            "character": loc.range.end.column
                        }
                    }
                })
            }).collect();

            Response::success(id, json!({
                "canDelete": analysis.can_delete,
                "symbolName": analysis.symbol_name,
                "usages": usages,
                "warnings": analysis.warnings
            }))
        }
        Err(e) => {
            Response::success(id, json!({
                "canDelete": false,
                "error": e.to_string()
            }))
        }
    }
}

/// Handle logos/safeDelete
pub fn safe_delete(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: RefactorParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid safeDelete params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;

    let doc = match state.get_document(uri) {
        Some(d) => d,
        None => {
            return Response::success(id, json!({"success": false, "error": "Document not found"}));
        }
    };

    let language = match logos_parser::LanguageId::from_str(&doc.language_id) {
        Some(l) => l,
        None => {
            return Response::success(id, json!({"success": false, "error": "Unsupported language"}));
        }
    };

    let selection = logos_core::Range::from_coords(
        params.range.start.line,
        params.range.start.character,
        params.range.end.line,
        params.range.end.character,
    );

    let ctx = logos_refactor::RefactorContext::new(doc.content(), uri, selection, language);

    match logos_refactor::safe_delete::delete(&ctx) {
        Ok(result) => {
            let edits: Vec<_> = result.edits.iter().map(|edit| {
                json!({
                    "range": {
                        "start": {
                            "line": edit.range.start.line,
                            "character": edit.range.start.column
                        },
                        "end": {
                            "line": edit.range.end.line,
                            "character": edit.range.end.column
                        }
                    },
                    "newText": edit.new_text
                })
            }).collect();

            Response::success(id, json!({
                "success": true,
                "edits": edits,
                "description": result.description
            }))
        }
        Err(e) => {
            let error_msg = match &e {
                logos_refactor::RefactorError::SymbolInUse(usages) => {
                    let usage_locs: Vec<_> = usages.iter().map(|loc| {
                        format!("{}:{}:{}", loc.uri, loc.range.start.line + 1, loc.range.start.column + 1)
                    }).collect();
                    format!("Symbol is still in use at: {}", usage_locs.join(", "))
                }
                _ => e.to_string()
            };

            Response::success(id, json!({
                "success": false,
                "error": error_msg
            }))
        }
    }
}
