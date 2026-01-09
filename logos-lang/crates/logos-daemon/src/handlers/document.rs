//! Document synchronization handlers

use log::debug;
use serde_json::Value;

use crate::protocol::{DidOpenTextDocumentParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams};
use crate::state::State;

/// Handle textDocument/didOpen
pub fn did_open(state: &mut State, params: &Value) {
    let params: DidOpenTextDocumentParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("Invalid didOpen params: {}", e);
            return;
        }
    };

    let doc = params.text_document;
    debug!("Opening document: {} ({})", doc.uri, doc.language_id);

    state.open_document(doc.uri, doc.language_id, doc.text);
}

/// Handle textDocument/didChange
pub fn did_change(state: &mut State, params: &Value) {
    let params: DidChangeTextDocumentParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("Invalid didChange params: {}", e);
            return;
        }
    };

    debug!("Changing document: {}", params.text_document.uri);

    // We use full sync, so just take the last change
    if let Some(change) = params.content_changes.last() {
        state.update_document(&params.text_document.uri, change.text.clone());
    }
}

/// Handle textDocument/didClose
pub fn did_close(state: &mut State, params: &Value) {
    let params: DidCloseTextDocumentParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("Invalid didClose params: {}", e);
            return;
        }
    };

    debug!("Closing document: {}", params.text_document.uri);

    state.close_document(&params.text_document.uri);
}
