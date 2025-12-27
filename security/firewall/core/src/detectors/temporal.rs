//! Temporal Attack Detector
//!
//! Detects time-based attack patterns:
//! - Time bomb triggers
//! - Delayed execution patterns
//! - Clock manipulation detection
//! - Scheduling-based evasion
//! - Date/time specific triggers

use crate::skills::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct TemporalDetector {
    date_regex: Regex,
    sleep_regex: Regex,
    timer_regex: Regex,
    schedule_regex: Regex,
}

impl TemporalDetector {
    pub fn new() -> Self {
        Self {
            // Matches specific dates that could be triggers
            date_regex: Regex::new(r"\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b").unwrap(),
            // Sleep/delay calls with large values
            sleep_regex: Regex::new(r"(?i)(?:sleep|delay|wait|timeout)\s*\(\s*(\d+)\s*\)").unwrap(),
            // setTimeout/setInterval with large delays
            timer_regex: Regex::new(r"(?:setTimeout|setInterval)\s*\([^,]+,\s*(\d+)\s*\)").unwrap(),
            // Scheduling keywords
            schedule_regex: Regex::new(r"(?i)\b(cron|schedule|at\s+\d|timer|periodic)\b").unwrap(),
        }
    }

    /// Detect hardcoded dates (potential time bombs)
    fn detect_time_bombs(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Look for date comparisons
        let comparison_patterns = [
            r"if\s*\([^)]*Date",
            r"if\s*\([^)]*getTime\s*\(\s*\)",
            r"if\s*\([^)]*timestamp",
            r"new\s+Date\s*\(\s*['\"]",
        ];

        for pattern in comparison_patterns {
            if let Ok(regex) = Regex::new(pattern) {
                let count = regex.find_iter(content).count();
                if count > 0 {
                    // Find associated dates
                    let dates: Vec<&str> = self.date_regex
                        .find_iter(content)
                        .map(|m| m.as_str())
                        .collect();

                    if !dates.is_empty() {
                        findings.push(Finding {
                            finding_type: "potential_time_bomb".to_string(),
                            value: json!({
                                "pattern": pattern,
                                "dates_found": dates,
                                "comparison_count": count
                            }),
                            confidence: 0.7,
                            location: path.display().to_string(),
                            severity: Severity::Critical,
                            metadata: json!({
                                "pattern": "Date-based trigger",
                                "description": format!("Found {} date comparisons with dates: {:?}", count, dates)
                            }),
                        });
                    }
                }
            }
        }

        findings
    }

    /// Detect delayed execution (evasion technique)
    fn detect_delayed_execution(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Check for long sleep delays (evasion)
        for cap in self.sleep_regex.captures_iter(content) {
            if let Ok(delay) = cap[1].parse::<u64>() {
                // Delays over 60 seconds are suspicious in code
                if delay > 60000 {
                    findings.push(Finding {
                        finding_type: "long_sleep_delay".to_string(),
                        value: json!({
                            "delay_ms": delay,
                            "delay_seconds": delay / 1000
                        }),
                        confidence: 0.75,
                        location: path.display().to_string(),
                        severity: Severity::High,
                        metadata: json!({
                            "pattern": "Long sleep delay",
                            "description": format!("Sleep for {} seconds - potential sandbox evasion", delay / 1000)
                        }),
                    });
                }
            }
        }

        // Check for long JS timers
        for cap in self.timer_regex.captures_iter(content) {
            if let Ok(delay) = cap[1].parse::<u64>() {
                if delay > 300000 {  // 5 minutes
                    findings.push(Finding {
                        finding_type: "long_timer_delay".to_string(),
                        value: json!({
                            "delay_ms": delay,
                            "delay_minutes": delay / 60000
                        }),
                        confidence: 0.7,
                        location: path.display().to_string(),
                        severity: Severity::Medium,
                        metadata: json!({
                            "pattern": "Long timer delay",
                            "description": format!("Timer with {} minute delay", delay / 60000)
                        }),
                    });
                }
            }
        }

        findings
    }

    /// Detect scheduling-based patterns
    fn detect_scheduling(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        let matches: Vec<&str> = self.schedule_regex
            .find_iter(content)
            .map(|m| m.as_str())
            .collect();

        if !matches.is_empty() {
            // Look for cron expressions
            let cron_regex = Regex::new(r"[\d*]+\s+[\d*]+\s+[\d*]+\s+[\d*]+\s+[\d*]+").unwrap();
            let cron_count = cron_regex.find_iter(content).count();

            findings.push(Finding {
                finding_type: "scheduling_detected".to_string(),
                value: json!({
                    "keywords": matches,
                    "cron_expressions": cron_count
                }),
                confidence: 0.6,
                location: path.display().to_string(),
                severity: Severity::Low,
                metadata: json!({
                    "pattern": "Scheduling mechanism",
                    "description": format!("Found scheduling keywords: {:?}", matches)
                }),
            });
        }

        findings
    }

    /// Analyze a single file
    fn analyze_file(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        if let Ok(content) = fs::read_to_string(path) {
            findings.extend(self.detect_time_bombs(path, &content));
            findings.extend(self.detect_delayed_execution(path, &content));
            findings.extend(self.detect_scheduling(path, &content));
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

impl Default for TemporalDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Skill for TemporalDetector {
    fn name(&self) -> &str {
        "detect_temporal_attacks"
    }

    fn description(&self) -> &str {
        "Detects time-based attack patterns including time bombs, \
         delayed execution for sandbox evasion, and scheduling mechanisms."
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
        vec!["temporal", "evasion", "malware"]
    }
}
