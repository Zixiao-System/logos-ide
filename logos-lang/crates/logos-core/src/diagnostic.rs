//! Diagnostic types for error/warning reporting

use crate::position::Range;
use serde::{Deserialize, Serialize};

/// Diagnostic severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

impl DiagnosticSeverity {
    /// Convert to Monaco marker severity
    pub fn to_monaco_severity(self) -> u32 {
        match self {
            DiagnosticSeverity::Error => 8,
            DiagnosticSeverity::Warning => 4,
            DiagnosticSeverity::Information => 2,
            DiagnosticSeverity::Hint => 1,
        }
    }
}

/// A diagnostic message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    /// Range of the diagnostic
    pub range: Range,
    /// Severity level
    pub severity: DiagnosticSeverity,
    /// Diagnostic code (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Source of the diagnostic (e.g., "logos-parser")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Diagnostic message
    pub message: String,
    /// Related information
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_information: Vec<DiagnosticRelatedInformation>,
}

impl Diagnostic {
    pub fn error(range: Range, message: String) -> Self {
        Self {
            range,
            severity: DiagnosticSeverity::Error,
            code: None,
            source: None,
            message,
            related_information: Vec::new(),
        }
    }

    pub fn warning(range: Range, message: String) -> Self {
        Self {
            range,
            severity: DiagnosticSeverity::Warning,
            code: None,
            source: None,
            message,
            related_information: Vec::new(),
        }
    }

    pub fn info(range: Range, message: String) -> Self {
        Self {
            range,
            severity: DiagnosticSeverity::Information,
            code: None,
            source: None,
            message,
            related_information: Vec::new(),
        }
    }

    pub fn hint(range: Range, message: String) -> Self {
        Self {
            range,
            severity: DiagnosticSeverity::Hint,
            code: None,
            source: None,
            message,
            related_information: Vec::new(),
        }
    }

    pub fn with_code(mut self, code: String) -> Self {
        self.code = Some(code);
        self
    }

    pub fn with_source(mut self, source: String) -> Self {
        self.source = Some(source);
        self
    }

    pub fn with_related(mut self, related: Vec<DiagnosticRelatedInformation>) -> Self {
        self.related_information = related;
        self
    }
}

/// Related information for a diagnostic
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticRelatedInformation {
    /// Location of the related information
    pub uri: String,
    pub range: Range,
    /// Message describing the relation
    pub message: String,
}

impl DiagnosticRelatedInformation {
    pub fn new(uri: String, range: Range, message: String) -> Self {
        Self { uri, range, message }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::Range;

    #[test]
    fn test_diagnostic_creation() {
        let range = Range::from_coords(0, 0, 0, 5);
        let diag = Diagnostic::error(range, "Syntax error".to_string())
            .with_code("E001".to_string())
            .with_source("logos-parser".to_string());

        assert_eq!(diag.severity, DiagnosticSeverity::Error);
        assert_eq!(diag.code, Some("E001".to_string()));
        assert_eq!(diag.source, Some("logos-parser".to_string()));
    }
}