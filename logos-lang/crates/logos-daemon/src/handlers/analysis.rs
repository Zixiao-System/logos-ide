//! Analysis handlers: TODO items, unused symbols

use serde_json::{json, Value};
use logos_index::TodoKind;

use crate::protocol::{DocumentSymbolParams, RequestId, Response};
use crate::state::State;

/// Handle logos/getTodoItems
pub fn get_todo_items(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: DocumentSymbolParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid getTodoItems params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;
    let todos = state.todo_index.get_document_todos(uri);

    let items: Vec<_> = todos.iter().map(|todo| {
        json!({
            "kind": todo_kind_to_string(todo.kind),
            "text": todo.text,
            "author": todo.author,
            "priority": todo.priority,
            "line": todo.line,
            "range": {
                "start": {
                    "line": todo.range.start.line,
                    "character": todo.range.start.column
                },
                "end": {
                    "line": todo.range.end.line,
                    "character": todo.range.end.column
                }
            }
        })
    }).collect();

    Response::success(id, json!(items))
}

/// Handle logos/getAllTodoItems
pub fn get_all_todo_items(state: &State, id: Option<RequestId>) -> Response {
    let todos = state.todo_index.get_all_todos();

    let items: Vec<_> = todos.iter().map(|(uri, todo)| {
        json!({
            "uri": uri,
            "kind": todo_kind_to_string(todo.kind),
            "text": todo.text,
            "author": todo.author,
            "priority": todo.priority,
            "line": todo.line,
            "range": {
                "start": {
                    "line": todo.range.start.line,
                    "character": todo.range.start.column
                },
                "end": {
                    "line": todo.range.end.line,
                    "character": todo.range.end.column
                }
            }
        })
    }).collect();

    Response::success(id, json!(items))
}

/// Handle logos/getTodoStats
pub fn get_todo_stats(state: &State, id: Option<RequestId>) -> Response {
    let count_by_kind = state.todo_index.count_by_kind();

    let stats = json!({
        "total": state.todo_index.todo_count(),
        "byKind": {
            "todo": count_by_kind.get(&TodoKind::Todo).unwrap_or(&0),
            "fixme": count_by_kind.get(&TodoKind::Fixme).unwrap_or(&0),
            "hack": count_by_kind.get(&TodoKind::Hack).unwrap_or(&0),
            "xxx": count_by_kind.get(&TodoKind::Xxx).unwrap_or(&0),
            "note": count_by_kind.get(&TodoKind::Note).unwrap_or(&0),
            "bug": count_by_kind.get(&TodoKind::Bug).unwrap_or(&0),
            "optimize": count_by_kind.get(&TodoKind::Optimize).unwrap_or(&0)
        }
    });

    Response::success(id, stats)
}

/// Handle logos/getUnusedSymbols
pub fn get_unused_symbols(state: &State, params: &Value, id: Option<RequestId>) -> Response {
    let params: DocumentSymbolParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid getUnusedSymbols params: {}", e),
            );
        }
    };

    let uri = &params.text_document.uri;

    let doc = match state.get_document(uri) {
        Some(d) => d,
        None => return Response::success(id, json!([])),
    };

    let symbols: Vec<_> = state.symbol_index.get_document_symbols(uri)
        .iter()
        .map(|s| logos_core::Symbol {
            name: s.name.clone(),
            kind: s.kind,
            range: s.range,
            selection_range: s.selection_range,
            detail: None,
            children: Vec::new(),
        })
        .collect();

    let mut detector = logos_semantic::UnusedDetector::new();
    let unused = detector.analyze(&symbols, doc.content());

    let items: Vec<_> = unused.iter().map(|item| {
        json!({
            "kind": format!("{:?}", item.kind).to_lowercase(),
            "name": item.name,
            "canRemove": item.can_remove,
            "fixAction": item.fix_action,
            "range": {
                "start": {
                    "line": item.range.start.line,
                    "character": item.range.start.column
                },
                "end": {
                    "line": item.range.end.line,
                    "character": item.range.end.column
                }
            }
        })
    }).collect();

    Response::success(id, json!(items))
}

fn todo_kind_to_string(kind: TodoKind) -> &'static str {
    match kind {
        TodoKind::Todo => "todo",
        TodoKind::Fixme => "fixme",
        TodoKind::Hack => "hack",
        TodoKind::Xxx => "xxx",
        TodoKind::Note => "note",
        TodoKind::Bug => "bug",
        TodoKind::Optimize => "optimize",
        TodoKind::Custom => "custom",
    }
}
