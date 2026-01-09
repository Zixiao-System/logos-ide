//! logos-daemon - Language service daemon for Logos IDE
//!
//! Communicates via stdio using JSON-RPC 2.0 protocol with LSP-style headers.

mod protocol;
mod server;
mod state;
mod handlers;

use std::io::{self, BufRead, BufReader, Read, Write};
use log::{info, error, debug};

fn main() {
    // Initialize logger
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info")
    ).init();

    info!("logos-daemon starting...");

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut stdout = stdout.lock();

    let mut server = server::Server::new();

    loop {
        // Read header
        let content_length = match read_header(&mut reader) {
            Ok(Some(len)) => len,
            Ok(None) => {
                info!("EOF reached, shutting down");
                break;
            }
            Err(e) => {
                error!("Error reading header: {}", e);
                continue;
            }
        };

        // Read body
        let mut body = vec![0u8; content_length];
        if let Err(e) = reader.read_exact(&mut body) {
            error!("Error reading body: {}", e);
            continue;
        }

        let body = match String::from_utf8(body) {
            Ok(s) => s,
            Err(e) => {
                error!("Invalid UTF-8 in body: {}", e);
                continue;
            }
        };

        debug!("Received: {}", body);

        // Handle message
        if let Some(response) = server.handle_message(&body) {
            let response_bytes = response.as_bytes();
            let header = format!("Content-Length: {}\r\n\r\n", response_bytes.len());

            if let Err(e) = stdout.write_all(header.as_bytes()) {
                error!("Error writing header: {}", e);
                break;
            }
            if let Err(e) = stdout.write_all(response_bytes) {
                error!("Error writing body: {}", e);
                break;
            }
            if let Err(e) = stdout.flush() {
                error!("Error flushing stdout: {}", e);
                break;
            }

            debug!("Sent: {}", response);
        }

        // Check if we should exit
        if server.should_exit() {
            info!("Exit requested, shutting down");
            break;
        }
    }

    info!("logos-daemon stopped");
}

/// Read LSP-style header and return content length
fn read_header<R: BufRead>(reader: &mut R) -> io::Result<Option<usize>> {
    let mut content_length: Option<usize> = None;
    let mut line = String::new();

    loop {
        line.clear();
        let bytes_read = reader.read_line(&mut line)?;

        if bytes_read == 0 {
            return Ok(None); // EOF
        }

        let line = line.trim();

        if line.is_empty() {
            // End of headers
            break;
        }

        if let Some(value) = line.strip_prefix("Content-Length: ") {
            content_length = value.parse().ok();
        }
        // Ignore other headers (like Content-Type)
    }

    content_length.ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "Missing Content-Length header")
    }).map(Some)
}
