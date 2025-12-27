//! Code Obfuscation Detector
//!
//! Detects obfuscation patterns:
//! - Control flow flattening
//! - String encryption patterns
//! - Dead code injection
//! - Opaque predicates
//! - High entropy sections

use crate::skills::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct ObfuscationDetector {
    hex_string_regex: Regex,
    base64_regex: Regex,
    switch_regex: Regex,
}

impl ObfuscationDetector {
    pub fn new() -> Self {
        Self {
            hex_string_regex: Regex::new(r#"["']\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){10,}["']"#).unwrap(),
            base64_regex: Regex::new(r#"["'][A-Za-z0-9+/]{40,}={0,2}["']"#).unwrap(),
            switch_regex: Regex::new(r"switch\s*\([^)]+\)\s*\{").unwrap(),
        }
    }

    /// Calculate Shannon entropy of a string
    fn calculate_entropy(&self, data: &str) -> f64 {
        if data.is_empty() {
            return 0.0;
        }

        let mut freq: HashMap<char, usize> = HashMap::new();
        for c in data.chars() {
            *freq.entry(c).or_insert(0) += 1;
        }

        let len = data.len() as f64;
        freq.values()
            .map(|&count| {
                let p = count as f64 / len;
                -p * p.log2()
            })
            .sum()
    }

    /// Detect encrypted/encoded strings (high entropy)
    fn detect_encrypted_strings(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Find hex-encoded strings
        for mat in self.hex_string_regex.find_iter(content) {
            findings.push(Finding {
                finding_type: "hex_encoded_string".to_string(),
                value: json!({
                    "length": mat.as_str().len(),
                    "preview": &mat.as_str()[..mat.as_str().len().min(50)]
                }),
                confidence: 0.85,
                location: path.display().to_string(),
                severity: Severity::Medium,
                metadata: json!({
                    "pattern": "Hex-encoded string",
                    "description": "Long hex-escaped string suggesting encoded payload"
                }),
            });
        }

        // Find base64 strings
        for mat in self.base64_regex.find_iter(content) {
            let entropy = self.calculate_entropy(mat.as_str());
            if entropy > 5.5 {
                findings.push(Finding {
                    finding_type: "base64_encoded_string".to_string(),
                    value: json!({
                        "length": mat.as_str().len(),
                        "entropy": entropy,
                        "preview": &mat.as_str()[..mat.as_str().len().min(50)]
                    }),
                    confidence: 0.8,
                    location: path.display().to_string(),
                    severity: Severity::Medium,
                    metadata: json!({
                        "pattern": "High-entropy Base64 string",
                        "description": format!("Entropy: {:.2} suggests encrypted content", entropy)
                    }),
                });
            }
        }

        findings
    }

    /// Detect control flow flattening (many switch cases with numeric labels)
    fn detect_control_flow_flattening(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        let switch_count = self.switch_regex.find_iter(content).count();
        let case_regex = Regex::new(r"case\s+\d+:").unwrap();
        let case_count = case_regex.find_iter(content).count();

        // Suspicious if many numeric case labels
        if case_count > 20 && (case_count as f64 / switch_count.max(1) as f64) > 10.0 {
            findings.push(Finding {
                finding_type: "control_flow_flattening".to_string(),
                value: json!({
                    "switch_count": switch_count,
                    "case_count": case_count,
                    "ratio": case_count as f64 / switch_count.max(1) as f64
                }),
                confidence: 0.75,
                location: path.display().to_string(),
                severity: Severity::High,
                metadata: json!({
                    "pattern": "Control flow flattening",
                    "description": format!("{} numeric cases across {} switches suggests obfuscation", case_count, switch_count)
                }),
            });
        }

        findings
    }

    /// Detect opaque predicates (always-true/false conditions)
    fn detect_opaque_predicates(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Common opaque predicate patterns
        let patterns = [
            (r"if\s*\(\s*\d+\s*[<>]=?\s*\d+\s*\)", "numeric comparison"),
            (r"if\s*\(\s*true\s*\)", "literal true"),
            (r"if\s*\(\s*false\s*\)", "literal false"),
            (r"if\s*\(\s*1\s*\)", "literal 1"),
            (r"if\s*\(\s*0\s*\)", "literal 0"),
            (r"while\s*\(\s*true\s*\)", "infinite while"),
        ];

        for (pattern, desc) in patterns {
            if let Ok(regex) = Regex::new(pattern) {
                let count = regex.find_iter(content).count();
                if count > 3 {
                    findings.push(Finding {
                        finding_type: "opaque_predicate".to_string(),
                        value: json!({
                            "pattern": pattern,
                            "count": count,
                            "type": desc
                        }),
                        confidence: 0.7,
                        location: path.display().to_string(),
                        severity: Severity::Medium,
                        metadata: json!({
                            "pattern": "Opaque predicate",
                            "description": format!("Found {} instances of '{}'", count, desc)
                        }),
                    });
                }
            }
        }

        findings
    }

    /// Analyze a single file
    fn analyze_file(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        if let Ok(content) = fs::read_to_string(path) {
            findings.extend(self.detect_encrypted_strings(path, &content));
            findings.extend(self.detect_control_flow_flattening(path, &content));
            findings.extend(self.detect_opaque_predicates(path, &content));
        }

        findings
    }

    /// Analyze a directory
    fn analyze_directory(&self, path: &Path, recursive: bool) -> Vec<Finding> {
        let mut findings = Vec::new();

        let walker = if recursive {
            WalkDir::new(path)
        } else {
            WalkDir::new(path).max_depth(1)
        };

        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                findings.extend(self.analyze_file(entry.path()));
            }
        }

        findings
    }
}

impl Default for ObfuscationDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Skill for ObfuscationDetector {
    fn name(&self) -> &str {
        "detect_obfuscation"
    }

    fn description(&self) -> &str {
        "Detects code obfuscation patterns including encrypted strings, \
         control flow flattening, and opaque predicates."
    }

    fn schema(&self) -> Value {
        schema::skill_schema(
            self.name(),
            self.description(),
            json!({
                "path": schema::string_param("File or directory to scan"),
                "recursive": schema::bool_param("Scan directories recursively", true)
            }),
            vec!["path"],
        )
    }

    fn execute(&self, params: Value) -> SkillResult<SkillOutput> {
        let scan_params = ScanParams::from_value(&params)?;
        let path = scan_params.path();

        if !path.exists() {
            return Err(SkillError::InvalidParams(format!(
                "Path does not exist: {}",
                path.display()
            )));
        }

        let findings = if path.is_file() {
            self.analyze_file(path)
        } else {
            self.analyze_directory(path, scan_params.recursive)
        };

        let threshold = self.confidence_threshold();
        let filtered: Vec<Finding> = findings
            .into_iter()
            .filter(|f| f.confidence >= threshold)
            .collect();

        Ok(SkillOutput::with_findings(filtered))
    }

    fn categories(&self) -> Vec<&str> {
        vec!["obfuscation", "malware", "pattern_detection"]
    }
}
