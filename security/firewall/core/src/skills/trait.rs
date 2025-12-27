//! Skill trait - the core interface for all detection capabilities
//!
//! Skills are ML-trainable detection modules that can be invoked as tools.
//! Each skill exposes a JSON schema for tool calling compatibility.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use thiserror::Error;

/// Errors that can occur during skill execution
#[derive(Error, Debug)]
pub enum SkillError {
    #[error("Invalid parameters: {0}")]
    InvalidParams(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Analysis failed: {0}")]
    AnalysisFailed(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub type SkillResult<T> = Result<T, SkillError>;

/// A finding from skill execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    /// Type of finding (e.g., "math_constant_seed", "lsb_anomaly")
    pub finding_type: String,

    /// The detected value or pattern
    pub value: Value,

    /// Confidence score (0.0 - 1.0)
    pub confidence: f32,

    /// Location where finding was detected
    pub location: String,

    /// Severity level
    pub severity: Severity,

    /// Additional metadata
    #[serde(default)]
    pub metadata: Value,
}

/// Severity levels for findings
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

/// Output from skill execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillOutput {
    /// All findings from this execution
    pub findings: Vec<Finding>,

    /// Overall confidence in results
    pub confidence: f32,

    /// Execution metadata (timing, stats, etc.)
    #[serde(default)]
    pub metadata: Value,

    /// Whether the scan completed fully
    pub complete: bool,
}

impl SkillOutput {
    pub fn empty() -> Self {
        Self {
            findings: Vec::new(),
            confidence: 1.0,
            metadata: Value::Null,
            complete: true,
        }
    }

    pub fn with_findings(findings: Vec<Finding>) -> Self {
        let confidence = if findings.is_empty() {
            1.0
        } else {
            findings.iter().map(|f| f.confidence).sum::<f32>() / findings.len() as f32
        };

        Self {
            findings,
            confidence,
            metadata: Value::Null,
            complete: true,
        }
    }
}

/// The core Skill trait - implement this for each detector
pub trait Skill: Send + Sync {
    /// Unique identifier for this skill
    fn name(&self) -> &str;

    /// Human-readable description
    fn description(&self) -> &str;

    /// JSON schema for tool calling (OpenAI/Anthropic compatible)
    fn schema(&self) -> Value;

    /// Execute the skill with given parameters
    fn execute(&self, params: Value) -> SkillResult<SkillOutput>;

    /// Minimum confidence threshold for reporting findings
    fn confidence_threshold(&self) -> f32 {
        0.7
    }

    /// Categories this skill belongs to
    fn categories(&self) -> Vec<&str> {
        vec![]
    }
}

/// Parameters commonly used across skills
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanParams {
    /// Path to scan (file or directory)
    pub path: String,

    /// Whether to scan recursively
    #[serde(default)]
    pub recursive: bool,

    /// Whether to perform deep analysis
    #[serde(default)]
    pub deep_scan: bool,

    /// File patterns to include (glob)
    #[serde(default)]
    pub include: Vec<String>,

    /// File patterns to exclude (glob)
    #[serde(default)]
    pub exclude: Vec<String>,
}

impl ScanParams {
    pub fn from_value(params: &Value) -> SkillResult<Self> {
        serde_json::from_value(params.clone()).map_err(|e| {
            SkillError::InvalidParams(format!("Failed to parse scan params: {}", e))
        })
    }

    pub fn path(&self) -> &Path {
        Path::new(&self.path)
    }
}

/// Helper to build JSON schemas for skills
pub mod schema {
    use serde_json::{json, Value};

    pub fn string_param(description: &str) -> Value {
        json!({
            "type": "string",
            "description": description
        })
    }

    pub fn bool_param(description: &str, default: bool) -> Value {
        json!({
            "type": "boolean",
            "description": description,
            "default": default
        })
    }

    pub fn array_param(description: &str, item_type: &str) -> Value {
        json!({
            "type": "array",
            "description": description,
            "items": { "type": item_type }
        })
    }

    pub fn skill_schema(
        name: &str,
        description: &str,
        properties: Value,
        required: Vec<&str>,
    ) -> Value {
        json!({
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required
            }
        })
    }
}
