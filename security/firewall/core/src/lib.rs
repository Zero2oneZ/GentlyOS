//! GentlyOS Firewall Core
//!
//! ML-trainable security detection skills for the GentlyOS security layer.
//!
//! # Overview
//!
//! This crate provides a modular detection framework with skills that can be:
//! - Invoked as tool calls (OpenAI/Anthropic function calling format)
//! - Used for ML training via exported JSON schemas
//! - Integrated with the existing GentlyOS SecuritySystem
//!
//! # Detection Categories
//!
//! - **Cipher**: Mathematical patterns, grids, self-referencing hashes
//! - **Steganography**: Hidden data in files
//! - **Obfuscation**: Code protection patterns
//! - **Network**: C2, DGA, suspicious endpoints
//! - **Temporal**: Time bombs, delayed execution
//! - **Audio**: Covert channels, ultrasonic communication
//! - **Injection**: Keyboard/HID attacks, clipboard hijacking
//!
//! # Example
//!
//! ```rust,ignore
//! use firewall_core::skills::{create_default_registry, SkillRegistry};
//! use serde_json::json;
//!
//! let registry = create_default_registry();
//!
//! // List available skills
//! for name in registry.list() {
//!     println!("Skill: {}", name);
//! }
//!
//! // Invoke a skill
//! let result = registry.invoke("detect_cipher_patterns", json!({
//!     "path": "/path/to/scan"
//! }));
//! ```

pub mod detectors;
pub mod skills;

// Re-export main types
pub use skills::{
    create_default_registry, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput,
    SkillRegistry, SkillResult,
};

/// Library version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Run all detectors on a path and return combined findings
pub fn scan_path(path: &str) -> SkillResult<Vec<Finding>> {
    let registry = create_default_registry();
    let params = serde_json::json!({ "path": path });

    let mut all_findings = Vec::new();

    for name in registry.list() {
        if let Ok(output) = registry.invoke(name, params.clone()) {
            all_findings.extend(output.findings);
        }
    }

    // Sort by severity (critical first) then confidence
    all_findings.sort_by(|a, b| {
        b.severity
            .cmp(&a.severity)
            .then(b.confidence.partial_cmp(&a.confidence).unwrap())
    });

    Ok(all_findings)
}

/// Export all skill schemas for ML training
pub fn export_tool_schemas() -> serde_json::Value {
    let registry = create_default_registry();
    registry.export_schemas()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_creation() {
        let registry = create_default_registry();
        let skills = registry.list();

        assert!(skills.contains(&"detect_cipher_patterns"));
        assert!(skills.contains(&"detect_steganography"));
        assert!(skills.contains(&"detect_obfuscation"));
        assert!(skills.contains(&"detect_network_patterns"));
        assert!(skills.contains(&"detect_temporal_attacks"));
        assert!(skills.contains(&"detect_audio_channels"));
        assert!(skills.contains(&"detect_injection_attacks"));
        assert!(skills.contains(&"detect_svg_injection"));
        assert!(skills.contains(&"detect_filesystem_threats"));
    }

    #[test]
    fn test_schema_export() {
        let schemas = export_tool_schemas();

        assert!(schemas.get("skills").is_some());
        assert!(schemas.get("version").is_some());
    }
}
