//! Lifecycle handlers: initialize, shutdown, exit

use log::info;
use serde_json::{json, Value};

use crate::protocol::{InitializeParams, RequestId, Response};
use crate::state::State;

/// Handle initialize request
pub fn initialize(state: &mut State, params: &Value, id: Option<RequestId>) -> Response {
    let params: InitializeParams = match serde_json::from_value(params.clone()) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(
                id,
                crate::protocol::error_codes::INVALID_PARAMS,
                format!("Invalid initialize params: {}", e),
            );
        }
    };

    info!("Initialize request received");
    info!("  Process ID: {:?}", params.process_id);
    info!("  Root path: {:?}", params.root_path);
    info!("  Root URI: {:?}", params.root_uri);

    state.root_path = params.root_path.or(params.root_uri);
    state.initialized = true;

    // Return server capabilities
    let capabilities = json!({
        "capabilities": {
            "textDocumentSync": {
                "openClose": true,
                "change": 1,  // Full sync
                "save": {
                    "includeText": false
                }
            },
            "completionProvider": {
                "triggerCharacters": [".", ":", "<", "\"", "'", "/", "@", "{", "("],
                "resolveProvider": false
            },
            "hoverProvider": true,
            "definitionProvider": true,
            "referencesProvider": true,
            "documentSymbolProvider": true,
            "workspaceSymbolProvider": true,
            "renameProvider": {
                "prepareProvider": true
            },
            "diagnosticProvider": {
                "interFileDependencies": false,
                "workspaceDiagnostics": false
            }
        },
        "serverInfo": {
            "name": "logos-daemon",
            "version": env!("CARGO_PKG_VERSION")
        }
    });

    Response::success(id, capabilities)
}

/// Handle initialized notification
pub fn initialized(state: &mut State) {
    info!("Client initialized, server is ready");
    state.initialized = true;
}
