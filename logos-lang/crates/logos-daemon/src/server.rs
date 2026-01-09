//! JSON-RPC server implementation

use log::{info, warn, debug};

use crate::protocol::{Request, Response, error_codes};
use crate::state::State;
use crate::handlers;

/// Language service server
pub struct Server {
    state: State,
    should_exit: bool,
    shutdown_requested: bool,
}

impl Server {
    pub fn new() -> Self {
        Self {
            state: State::new(),
            should_exit: false,
            shutdown_requested: false,
        }
    }

    /// Handle an incoming JSON-RPC message
    pub fn handle_message(&mut self, message: &str) -> Option<String> {
        // Parse the message
        let request: Request = match serde_json::from_str(message) {
            Ok(req) => req,
            Err(e) => {
                warn!("Failed to parse request: {}", e);
                let response = Response::error(
                    None,
                    error_codes::PARSE_ERROR,
                    format!("Parse error: {}", e),
                );
                return Some(serde_json::to_string(&response).unwrap());
            }
        };

        debug!("Handling method: {}", request.method);

        // Dispatch to handler
        let response = self.dispatch(&request);

        // If this was a notification (no id), don't send a response
        if request.id.is_none() {
            return None;
        }

        Some(serde_json::to_string(&response).unwrap())
    }

    /// Dispatch a request to the appropriate handler
    fn dispatch(&mut self, request: &Request) -> Response {
        let id = request.id.clone();

        match request.method.as_str() {
            // Lifecycle
            "initialize" => {
                handlers::lifecycle::initialize(&mut self.state, &request.params, id)
            }
            "initialized" => {
                handlers::lifecycle::initialized(&mut self.state);
                Response::null_result(id)
            }
            "shutdown" => {
                self.shutdown_requested = true;
                info!("Shutdown requested");
                Response::null_result(id)
            }
            "exit" => {
                self.should_exit = true;
                info!("Exit requested");
                Response::null_result(id)
            }

            // Document synchronization
            "textDocument/didOpen" => {
                handlers::document::did_open(&mut self.state, &request.params);
                Response::null_result(id)
            }
            "textDocument/didChange" => {
                handlers::document::did_change(&mut self.state, &request.params);
                Response::null_result(id)
            }
            "textDocument/didClose" => {
                handlers::document::did_close(&mut self.state, &request.params);
                Response::null_result(id)
            }

            // Language features
            "textDocument/completion" => {
                handlers::completion::handle(&self.state, &request.params, id)
            }
            "textDocument/definition" => {
                handlers::definition::handle(&self.state, &request.params, id)
            }
            "textDocument/references" => {
                handlers::references::handle(&self.state, &request.params, id)
            }
            "textDocument/hover" => {
                handlers::hover::handle(&self.state, &request.params, id)
            }
            "textDocument/documentSymbol" => {
                handlers::symbols::document_symbols(&self.state, &request.params, id)
            }
            "workspace/symbol" => {
                handlers::symbols::workspace_symbols(&self.state, &request.params, id)
            }
            "textDocument/rename" => {
                handlers::rename::handle(&self.state, &request.params, id)
            }
            "textDocument/prepareRename" => {
                handlers::rename::prepare(&self.state, &request.params, id)
            }

            // Diagnostics
            "textDocument/diagnostic" => {
                handlers::diagnostics::handle(&self.state, &request.params, id)
            }

            // Refactoring
            "logos/getRefactorActions" => {
                handlers::refactor::get_actions(&self.state, &request.params, id)
            }
            "logos/extractVariable" => {
                handlers::refactor::extract_variable(&self.state, &request.params, id)
            }
            "logos/extractMethod" => {
                handlers::refactor::extract_method(&self.state, &request.params, id)
            }
            "logos/canSafeDelete" => {
                handlers::refactor::can_safe_delete(&self.state, &request.params, id)
            }
            "logos/safeDelete" => {
                handlers::refactor::safe_delete(&self.state, &request.params, id)
            }

            // Analysis
            "logos/getTodoItems" => {
                handlers::analysis::get_todo_items(&self.state, &request.params, id)
            }
            "logos/getAllTodoItems" => {
                handlers::analysis::get_all_todo_items(&self.state, id)
            }
            "logos/getTodoStats" => {
                handlers::analysis::get_todo_stats(&self.state, id)
            }
            "logos/getUnusedSymbols" => {
                handlers::analysis::get_unused_symbols(&self.state, &request.params, id)
            }

            // Unknown method
            _ => {
                warn!("Method not found: {}", request.method);
                Response::error(
                    id,
                    error_codes::METHOD_NOT_FOUND,
                    format!("Method not found: {}", request.method),
                )
            }
        }
    }

    /// Check if the server should exit
    pub fn should_exit(&self) -> bool {
        self.should_exit
    }
}

impl Default for Server {
    fn default() -> Self {
        Self::new()
    }
}
