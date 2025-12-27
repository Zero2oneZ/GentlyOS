//! Input Injection Detector
//!
//! Detects input-based attack patterns:
//! - Keyboard injection signatures
//! - HID attack patterns
//! - Clipboard hijacking
//! - Input timing anomalies
//! - Keystroke simulation

use crate::skills::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct InjectionDetector {
    keyboard_regex: Regex,
    clipboard_regex: Regex,
    hid_regex: Regex,
    automation_regex: Regex,
}

impl InjectionDetector {
    pub fn new() -> Self {
        Self {
            // Keyboard simulation APIs
            keyboard_regex: Regex::new(
                r"(?i)\b(keybd_event|SendInput|SendKeys|robot\.keyPress|dispatchKeyEvent|KeyboardEvent)\b"
            ).unwrap(),
            // Clipboard access
            clipboard_regex: Regex::new(
                r"(?i)\b(clipboard|navigator\.clipboard|execCommand.*copy|execCommand.*paste|SetClipboardData|GetClipboardData)\b"
            ).unwrap(),
            // HID/USB device access
            hid_regex: Regex::new(
                r"(?i)\b(HID|USB|navigator\.hid|WebUSB|libusb|hidapi)\b"
            ).unwrap(),
            // Automation frameworks
            automation_regex: Regex::new(
                r"(?i)\b(pyautogui|pynput|keyboard\.press|mouse\.click|AutoHotkey|AutoIt)\b"
            ).unwrap(),
        }
    }

    /// Detect keyboard injection patterns
    fn detect_keyboard_injection(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        let keyboard_matches: Vec<&str> = self.keyboard_regex
            .find_iter(content)
            .map(|m| m.as_str())
            .collect();

        if !keyboard_matches.is_empty() {
            // Check for suspicious patterns
            let has_loop = Regex::new(r"(?i)(for|while|loop)").unwrap().is_match(content);
            let has_delay = Regex::new(r"(?i)(sleep|delay|wait|timeout)").unwrap().is_match(content);

            let severity = if has_loop && has_delay {
                Severity::Critical
            } else if has_loop {
                Severity::High
            } else {
                Severity::Medium
            };

            let confidence = if has_loop && has_delay { 0.9 } else { 0.75 };

            findings.push(Finding {
                finding_type: "keyboard_injection".to_string(),
                value: json!({
                    "apis": keyboard_matches,
                    "has_loop": has_loop,
                    "has_delay": has_delay
                }),
                confidence,
                location: path.display().to_string(),
                severity,
                metadata: json!({
                    "pattern": "Keyboard injection",
                    "description": format!(
                        "Keyboard simulation APIs: {:?}{}",
                        keyboard_matches,
                        if has_loop { " (with loop - automated injection)" } else { "" }
                    )
                }),
            });
        }

        findings
    }

    /// Detect clipboard hijacking
    fn detect_clipboard_hijacking(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        let clipboard_matches: Vec<&str> = self.clipboard_regex
            .find_iter(content)
            .map(|m| m.as_str())
            .collect();

        if !clipboard_matches.is_empty() {
            // Check for clipboard monitoring patterns
            let has_interval = Regex::new(r"(?i)(setInterval|polling|monitor|watch)").unwrap().is_match(content);
            let has_crypto = Regex::new(r"(?i)(bitcoin|btc|eth|wallet|0x[a-fA-F0-9]{40})").unwrap().is_match(content);

            let severity = if has_crypto {
                Severity::Critical
            } else if has_interval {
                Severity::High
            } else {
                Severity::Medium
            };

            let confidence = if has_crypto { 0.95 } else if has_interval { 0.8 } else { 0.65 };

            findings.push(Finding {
                finding_type: "clipboard_access".to_string(),
                value: json!({
                    "apis": clipboard_matches,
                    "has_monitoring": has_interval,
                    "has_crypto_keywords": has_crypto
                }),
                confidence,
                location: path.display().to_string(),
                severity,
                metadata: json!({
                    "pattern": if has_crypto {
                        "Crypto clipboard hijacker"
                    } else if has_interval {
                        "Clipboard monitoring"
                    } else {
                        "Clipboard access"
                    },
                    "description": format!("Clipboard APIs: {:?}", clipboard_matches)
                }),
            });
        }

        findings
    }

    /// Detect HID/USB attack patterns
    fn detect_hid_attacks(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        let hid_matches: Vec<&str> = self.hid_regex
            .find_iter(content)
            .map(|m| m.as_str())
            .collect();

        if !hid_matches.is_empty() {
            // Check for keyboard emulation (BadUSB-style)
            let has_keyboard = self.keyboard_regex.is_match(content);
            let has_vendor_id = Regex::new(r"(?i)(vendor.*id|vid|0x[0-9a-f]{4})").unwrap().is_match(content);

            let severity = if has_keyboard {
                Severity::Critical
            } else {
                Severity::High
            };

            findings.push(Finding {
                finding_type: "hid_device_access".to_string(),
                value: json!({
                    "apis": hid_matches,
                    "has_keyboard_emulation": has_keyboard,
                    "has_vendor_id": has_vendor_id
                }),
                confidence: if has_keyboard { 0.85 } else { 0.7 },
                location: path.display().to_string(),
                severity,
                metadata: json!({
                    "pattern": if has_keyboard { "HID keyboard emulation (BadUSB-style)" } else { "HID device access" },
                    "description": format!("HID APIs: {:?}", hid_matches)
                }),
            });
        }

        findings
    }

    /// Detect automation framework usage
    fn detect_automation(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        let automation_matches: Vec<&str> = self.automation_regex
            .find_iter(content)
            .map(|m| m.as_str())
            .collect();

        if !automation_matches.is_empty() {
            findings.push(Finding {
                finding_type: "automation_framework".to_string(),
                value: json!({
                    "frameworks": automation_matches
                }),
                confidence: 0.7,
                location: path.display().to_string(),
                severity: Severity::Medium,
                metadata: json!({
                    "pattern": "Automation framework",
                    "description": format!("Found automation tools: {:?}", automation_matches)
                }),
            });
        }

        findings
    }

    /// Analyze a single file
    fn analyze_file(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        if let Ok(content) = fs::read_to_string(path) {
            findings.extend(self.detect_keyboard_injection(path, &content));
            findings.extend(self.detect_clipboard_hijacking(path, &content));
            findings.extend(self.detect_hid_attacks(path, &content));
            findings.extend(self.detect_automation(path, &content));
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

impl Default for InjectionDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Skill for InjectionDetector {
    fn name(&self) -> &str {
        "detect_injection_attacks"
    }

    fn description(&self) -> &str {
        "Detects input injection patterns including keyboard simulation, \
         clipboard hijacking, HID attacks, and automation frameworks."
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
        vec!["injection", "hid", "clipboard", "malware"]
    }
}
