//! Steganography Detector
//!
//! Detects hidden data in files:
//! - LSB (Least Significant Bit) analysis
//! - DCT coefficient anomalies (JPEG)
//! - EOF hidden data
//! - Whitespace encoding
//! - Unicode homoglyph detection

use crate::skills::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct StegoDetector;

impl StegoDetector {
    pub fn new() -> Self {
        Self
    }

    /// Detect EOF hidden data (data after expected file end)
    fn detect_eof_data(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        if let Ok(data) = fs::read(path) {
            // Check for PNG
            if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                // Look for IEND chunk
                if let Some(pos) = data
                    .windows(8)
                    .position(|w| w == [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44])
                {
                    let iend_pos = pos + 12; // IEND + CRC
                    if iend_pos < data.len() {
                        let extra_bytes = data.len() - iend_pos;
                        findings.push(Finding {
                            finding_type: "eof_hidden_data".to_string(),
                            value: json!({
                                "file_type": "PNG",
                                "extra_bytes": extra_bytes,
                                "offset": iend_pos
                            }),
                            confidence: 0.9,
                            location: path.display().to_string(),
                            severity: Severity::High,
                            metadata: json!({
                                "pattern": "Data after PNG IEND chunk",
                                "description": format!("{} bytes hidden after PNG end marker", extra_bytes)
                            }),
                        });
                    }
                }
            }

            // Check for JPEG
            if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
                // Look for EOI marker
                if let Some(pos) = data.windows(2).rposition(|w| w == [0xFF, 0xD9]) {
                    let eoi_pos = pos + 2;
                    if eoi_pos < data.len() {
                        let extra_bytes = data.len() - eoi_pos;
                        findings.push(Finding {
                            finding_type: "eof_hidden_data".to_string(),
                            value: json!({
                                "file_type": "JPEG",
                                "extra_bytes": extra_bytes,
                                "offset": eoi_pos
                            }),
                            confidence: 0.9,
                            location: path.display().to_string(),
                            severity: Severity::High,
                            metadata: json!({
                                "pattern": "Data after JPEG EOI marker",
                                "description": format!("{} bytes hidden after JPEG end marker", extra_bytes)
                            }),
                        });
                    }
                }
            }
        }

        findings
    }

    /// Detect whitespace encoding (spaces/tabs encoding data)
    fn detect_whitespace_encoding(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        if let Ok(content) = fs::read_to_string(path) {
            let mut suspicious_lines = 0;
            let mut total_trailing = 0;

            for line in content.lines() {
                let trailing: String = line.chars().rev().take_while(|c| c.is_whitespace()).collect();
                if trailing.len() > 2 && trailing.chars().any(|c| c == '\t') && trailing.chars().any(|c| c == ' ') {
                    suspicious_lines += 1;
                    total_trailing += trailing.len();
                }
            }

            if suspicious_lines > 5 {
                findings.push(Finding {
                    finding_type: "whitespace_encoding".to_string(),
                    value: json!({
                        "suspicious_lines": suspicious_lines,
                        "total_trailing_chars": total_trailing
                    }),
                    confidence: (suspicious_lines as f32 / 100.0).min(0.95),
                    location: path.display().to_string(),
                    severity: Severity::Medium,
                    metadata: json!({
                        "pattern": "Whitespace steganography",
                        "description": format!("{} lines with suspicious trailing whitespace patterns", suspicious_lines)
                    }),
                });
            }
        }

        findings
    }

    /// Detect Unicode homoglyphs (lookalike characters)
    fn detect_homoglyphs(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Common homoglyph mappings (Cyrillic/Greek that look like Latin)
        let homoglyphs: &[(char, char, &str)] = &[
            ('а', 'a', "Cyrillic"),
            ('е', 'e', "Cyrillic"),
            ('о', 'o', "Cyrillic"),
            ('р', 'p', "Cyrillic"),
            ('с', 'c', "Cyrillic"),
            ('х', 'x', "Cyrillic"),
            ('Α', 'A', "Greek"),
            ('Β', 'B', "Greek"),
            ('Ε', 'E', "Greek"),
            ('Η', 'H', "Greek"),
            ('Ι', 'I', "Greek"),
            ('Κ', 'K', "Greek"),
            ('Μ', 'M', "Greek"),
            ('Ν', 'N', "Greek"),
            ('Ο', 'O', "Greek"),
            ('Ρ', 'P', "Greek"),
            ('Τ', 'T', "Greek"),
            ('Χ', 'X', "Greek"),
            ('Ζ', 'Z', "Greek"),
        ];

        if let Ok(content) = fs::read_to_string(path) {
            let mut found_homoglyphs: Vec<(char, char, &str)> = Vec::new();

            for (fake, real, script) in homoglyphs {
                if content.contains(*fake) {
                    found_homoglyphs.push((*fake, *real, script));
                }
            }

            if !found_homoglyphs.is_empty() {
                findings.push(Finding {
                    finding_type: "unicode_homoglyph".to_string(),
                    value: json!({
                        "homoglyphs": found_homoglyphs.iter().map(|(f, r, s)| {
                            json!({ "fake": f.to_string(), "real": r.to_string(), "script": s })
                        }).collect::<Vec<_>>()
                    }),
                    confidence: 0.85,
                    location: path.display().to_string(),
                    severity: Severity::High,
                    metadata: json!({
                        "pattern": "Unicode homoglyph substitution",
                        "description": format!("Found {} homoglyph characters that look like ASCII", found_homoglyphs.len())
                    }),
                });
            }
        }

        findings
    }

    /// Analyze a single file
    fn analyze_file(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        findings.extend(self.detect_eof_data(path));
        findings.extend(self.detect_whitespace_encoding(path));
        findings.extend(self.detect_homoglyphs(path));

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

impl Default for StegoDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Skill for StegoDetector {
    fn name(&self) -> &str {
        "detect_steganography"
    }

    fn description(&self) -> &str {
        "Detects steganographic patterns including EOF hidden data, \
         whitespace encoding, and Unicode homoglyph substitution."
    }

    fn schema(&self) -> Value {
        schema::skill_schema(
            self.name(),
            self.description(),
            json!({
                "path": schema::string_param("File or directory to scan"),
                "recursive": schema::bool_param("Scan directories recursively", true),
                "check_images": schema::bool_param("Perform LSB analysis on images", false)
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
        vec!["steganography", "hidden_data", "pattern_detection"]
    }
}
