//! Cipher Pattern Detector
//!
//! Detects cryptographic patterns that are UPDATE-PROOF:
//! - Mathematical constant seeds (φ, π, e, √2, etc.)
//! - Power-of-2 grid structures
//! - Self-referencing hash patterns
//! - GUID modular correlations
//! - Low-discrepancy sequence indicators

use crate::skills::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

/// Mathematical constants used as cipher seeds
const KNOWN_CONSTANTS: &[(&str, f64)] = &[
    ("phi", 1.6180339887498948482),
    ("phi_minus_1", 0.6180339887498948482),
    ("pi", 3.1415926535897932385),
    ("e", 2.7182818284590452354),
    ("sqrt2", 1.4142135623730950488),
    ("sqrt3", 1.7320508075688772935),
    ("sqrt5", 2.2360679774997896964),
    ("ln2", 0.6931471805599453094),
    ("ln10", 2.3025850929940456840),
    ("euler_gamma", 0.5772156649015328606),
];

/// Scales used to convert constants to integers
const SCALES: &[f64] = &[1e3, 1e6, 1e7, 1e8, 1e9, 1e10, 1e12];

/// Cipher pattern detector
pub struct CipherDetector {
    number_regex: Regex,
    dimension_regex: Regex,
    md5_regex: Regex,
    sha256_regex: Regex,
    guid_regex: Regex,
    sequence_keywords: HashMap<&'static str, &'static str>,
}

impl CipherDetector {
    pub fn new() -> Self {
        let mut sequence_keywords = HashMap::new();
        sequence_keywords.insert("golden", "weyl_golden");
        sequence_keywords.insert("halton", "halton");
        sequence_keywords.insert("sobol", "sobol");
        sequence_keywords.insert("quasi", "quasi_random");
        sequence_keywords.insert("weyl", "weyl");

        Self {
            number_regex: Regex::new(r"\b(\d{6,12})\b").unwrap(),
            dimension_regex: Regex::new(r"(\d+)\s*[xX×]\s*(\d+)(?:\s*[xX×]\s*(\d+))?").unwrap(),
            md5_regex: Regex::new(r"\b([0-9a-fA-F]{32})\b").unwrap(),
            sha256_regex: Regex::new(r"\b([0-9a-fA-F]{64})\b").unwrap(),
            guid_regex: Regex::new(
                r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
            )
            .unwrap(),
            sequence_keywords,
        }
    }

    /// Check if a number is a scaled mathematical constant
    fn check_constant(&self, value: u64) -> Option<(&str, f64, f64)> {
        for (name, const_val) in KNOWN_CONSTANTS {
            for &scale in SCALES {
                let expected = (*const_val * scale) as u64;
                let tolerance = (scale / 1000.0) as u64;

                if value.abs_diff(expected) <= tolerance {
                    let confidence =
                        1.0 - (value.abs_diff(expected) as f64 / (tolerance as f64 + 1.0));
                    return Some((name, scale, confidence));
                }
            }
        }
        None
    }

    /// Check if a number is a power of 2
    fn is_power_of_2(n: u64) -> bool {
        n > 0 && (n & (n - 1)) == 0
    }

    /// Detect mathematical constant seeds in text
    fn detect_math_constants(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        for cap in self.number_regex.captures_iter(content) {
            if let Ok(num) = cap[1].parse::<u64>() {
                if let Some((const_name, scale, confidence)) = self.check_constant(num) {
                    findings.push(Finding {
                        finding_type: "math_constant_seed".to_string(),
                        value: json!({
                            "number": num,
                            "constant": const_name,
                            "scale": scale
                        }),
                        confidence: confidence as f32,
                        location: path.display().to_string(),
                        severity: Severity::High,
                        metadata: json!({
                            "pattern": "Mathematical constant used as seed",
                            "description": format!("{} scaled by {}", const_name, scale)
                        }),
                    });
                }
            }
        }

        findings
    }

    /// Detect power-of-2 grid patterns
    fn detect_grid_patterns(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        for cap in self.dimension_regex.captures_iter(content) {
            let dims: Vec<u64> = (1..=3)
                .filter_map(|i| cap.get(i))
                .filter_map(|m| m.as_str().parse().ok())
                .collect();

            if dims.iter().all(|&d| Self::is_power_of_2(d)) {
                let total: u64 = dims.iter().product();

                findings.push(Finding {
                    finding_type: "power2_grid".to_string(),
                    value: json!({
                        "dimensions": dims,
                        "total_cells": total
                    }),
                    confidence: 0.9,
                    location: path.display().to_string(),
                    severity: Severity::Medium,
                    metadata: json!({
                        "pattern": "Power-of-2 grid structure",
                        "description": format!("{:?} = {} cells", dims, total)
                    }),
                });
            }
        }

        findings
    }

    /// Detect self-referencing hash patterns
    fn detect_self_reference(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Check MD5 hashes
        for cap in self.md5_regex.captures_iter(content) {
            let hash_val = &cap[1];
            let content_without = content.replace(hash_val, "");
            let computed = format!("{:x}", md5::compute(content_without.as_bytes()));

            if computed.eq_ignore_ascii_case(hash_val) {
                findings.push(Finding {
                    finding_type: "self_referencing_hash".to_string(),
                    value: json!({
                        "hash": hash_val,
                        "algorithm": "md5",
                        "verified": true
                    }),
                    confidence: 0.99,
                    location: path.display().to_string(),
                    severity: Severity::Critical,
                    metadata: json!({
                        "pattern": "Self-referencing MD5 hash",
                        "description": "File contains hash of itself (minus the hash)"
                    }),
                });
            }
        }

        // Check SHA256 hashes
        for cap in self.sha256_regex.captures_iter(content) {
            let hash_val = &cap[1];
            let content_without = content.replace(hash_val, "");
            let mut hasher = Sha256::new();
            hasher.update(content_without.as_bytes());
            let computed = format!("{:x}", hasher.finalize());

            if computed.eq_ignore_ascii_case(hash_val) {
                findings.push(Finding {
                    finding_type: "self_referencing_hash".to_string(),
                    value: json!({
                        "hash": hash_val,
                        "algorithm": "sha256",
                        "verified": true
                    }),
                    confidence: 0.99,
                    location: path.display().to_string(),
                    severity: Severity::Critical,
                    metadata: json!({
                        "pattern": "Self-referencing SHA256 hash",
                        "description": "File contains hash of itself (minus the hash)"
                    }),
                });
            }
        }

        findings
    }

    /// Detect GUID modular correlation patterns
    fn detect_guid_patterns(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        let guids: Vec<&str> = self.guid_regex.find_iter(content).map(|m| m.as_str()).collect();

        if guids.len() < 3 {
            return findings;
        }

        let test_moduli: &[u64] = &[64, 256, 1024, 131072];

        for &modulus in test_moduli {
            let values: Vec<u64> = guids
                .iter()
                .filter_map(|guid| {
                    let hex = guid.replace('-', "");
                    u128::from_str_radix(&hex, 16).ok().map(|v| (v % modulus as u128) as u64)
                })
                .collect();

            if values.is_empty() {
                continue;
            }

            // Find most common value
            let mut counts: HashMap<u64, usize> = HashMap::new();
            for &v in &values {
                *counts.entry(v).or_insert(0) += 1;
            }

            if let Some((&most_common, &count)) = counts.iter().max_by_key(|(_, &c)| c) {
                let ratio = count as f32 / values.len() as f32;

                // Suspicious if more than 30% cluster to same value
                if ratio > 0.3 {
                    findings.push(Finding {
                        finding_type: "guid_modular_correlation".to_string(),
                        value: json!({
                            "modulus": modulus,
                            "common_value": most_common,
                            "count": count,
                            "total": guids.len(),
                            "ratio": ratio
                        }),
                        confidence: ratio,
                        location: path.display().to_string(),
                        severity: Severity::High,
                        metadata: json!({
                            "pattern": "GUID modular correlation",
                            "description": format!("{}/{} GUIDs have mod {} = {}", count, guids.len(), modulus, most_common)
                        }),
                    });
                }
            }
        }

        findings
    }

    /// Detect low-discrepancy sequence indicators
    fn detect_sequence_patterns(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();
        let content_lower = content.to_lowercase();

        for (keyword, seq_type) in &self.sequence_keywords {
            if content_lower.contains(keyword) {
                findings.push(Finding {
                    finding_type: "sequence_indicator".to_string(),
                    value: json!({
                        "keyword": keyword,
                        "sequence_type": seq_type
                    }),
                    confidence: 0.7,
                    location: path.display().to_string(),
                    severity: Severity::Medium,
                    metadata: json!({
                        "pattern": "Low-discrepancy sequence indicator",
                        "description": format!("Found '{}' suggesting {} sequence", keyword, seq_type)
                    }),
                });
            }
        }

        // Also check for "bacon" or "cipher" in identifiers
        let identifier_regex = Regex::new(r"\b([a-zA-Z_][a-zA-Z0-9_]{2,30})\b").unwrap();
        for cap in identifier_regex.captures_iter(content) {
            let ident = &cap[1];
            let ident_lower = ident.to_lowercase();

            if ident_lower.contains("bacon") || ident_lower.contains("cipher") {
                findings.push(Finding {
                    finding_type: "cipher_hint_identifier".to_string(),
                    value: json!({ "identifier": ident }),
                    confidence: 0.7,
                    location: path.display().to_string(),
                    severity: Severity::Low,
                    metadata: json!({
                        "pattern": "Cipher hint in identifier",
                        "description": format!("Identifier '{}' suggests cipher involvement", ident)
                    }),
                });
            }
        }

        findings
    }

    /// Analyze a single file
    fn analyze_file(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Try to read as text
        if let Ok(content) = fs::read_to_string(path) {
            findings.extend(self.detect_math_constants(path, &content));
            findings.extend(self.detect_grid_patterns(path, &content));
            findings.extend(self.detect_self_reference(path, &content));
            findings.extend(self.detect_guid_patterns(path, &content));
            findings.extend(self.detect_sequence_patterns(path, &content));
        }

        findings
    }

    /// Analyze a directory recursively
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

impl Default for CipherDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Skill for CipherDetector {
    fn name(&self) -> &str {
        "detect_cipher_patterns"
    }

    fn description(&self) -> &str {
        "Detects cryptographic patterns including mathematical constant seeds, \
         power-of-2 grids, self-referencing hashes, GUID correlations, and \
         low-discrepancy sequence indicators. These patterns are update-proof \
         as they detect methodology, not specific values."
    }

    fn schema(&self) -> Value {
        schema::skill_schema(
            self.name(),
            self.description(),
            json!({
                "path": schema::string_param("File or directory to scan"),
                "recursive": schema::bool_param("Scan directories recursively", true),
                "deep_scan": schema::bool_param("Perform deeper binary analysis", false)
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

        // Filter by confidence threshold
        let threshold = self.confidence_threshold();
        let filtered: Vec<Finding> = findings
            .into_iter()
            .filter(|f| f.confidence >= threshold)
            .collect();

        Ok(SkillOutput::with_findings(filtered))
    }

    fn categories(&self) -> Vec<&str> {
        vec!["cipher", "crypto", "pattern_detection"]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_math_constant_detection() {
        let detector = CipherDetector::new();

        // φ * 1e9 = 1618033988
        assert!(detector.check_constant(1618033988).is_some());

        // π * 1e9 = 3141592653
        assert!(detector.check_constant(3141592653).is_some());

        // Random number should not match
        assert!(detector.check_constant(1234567890).is_none());
    }

    #[test]
    fn test_power_of_2() {
        assert!(CipherDetector::is_power_of_2(64));
        assert!(CipherDetector::is_power_of_2(256));
        assert!(CipherDetector::is_power_of_2(131072));
        assert!(!CipherDetector::is_power_of_2(100));
        assert!(!CipherDetector::is_power_of_2(0));
    }
}
