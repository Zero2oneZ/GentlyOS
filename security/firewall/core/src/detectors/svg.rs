//! SVG Injection Detector
//!
//! Detects malicious patterns in SVG files:
//! - Embedded JavaScript (<script>, onclick, onload, etc.)
//! - External resource loading (xlink:href, use)
//! - Data URI payloads
//! - foreignObject exploits
//! - CSS injection (@import, expression)
//! - Entity expansion attacks (XXE)
//! - Event handler injection

use crate::skills::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct SvgDetector {
    script_tag_regex: Regex,
    event_handler_regex: Regex,
    xlink_regex: Regex,
    data_uri_regex: Regex,
    foreign_object_regex: Regex,
    css_injection_regex: Regex,
    entity_regex: Regex,
    use_tag_regex: Regex,
    iframe_regex: Regex,
    base64_js_regex: Regex,
}

impl SvgDetector {
    pub fn new() -> Self {
        Self {
            // Script tags
            script_tag_regex: Regex::new(r"(?i)<script[^>]*>[\s\S]*?</script>").unwrap(),

            // Event handlers (onclick, onload, onerror, onmouseover, etc.)
            event_handler_regex: Regex::new(
                r#"(?i)\b(on(?:click|load|error|mouseover|mouseout|mousemove|mousedown|mouseup|focus|blur|change|submit|reset|select|abort|beforeunload|unload|resize|scroll|keydown|keyup|keypress|drag|drop|copy|cut|paste|animationstart|animationend|transitionend))\s*=\s*["'][^"']*["']"#
            ).unwrap(),

            // External references via xlink:href or href
            xlink_regex: Regex::new(
                r#"(?i)(?:xlink:)?href\s*=\s*["'](?:javascript:|data:|https?://|//)[^"']*["']"#
            ).unwrap(),

            // Data URIs (especially with base64 JavaScript)
            data_uri_regex: Regex::new(
                r#"(?i)data:\s*(?:text/html|application/javascript|text/javascript|image/svg\+xml)[^"'\s>]*"#
            ).unwrap(),

            // foreignObject (can embed HTML)
            foreign_object_regex: Regex::new(
                r"(?i)<foreignObject[^>]*>[\s\S]*?</foreignObject>"
            ).unwrap(),

            // CSS injection patterns
            css_injection_regex: Regex::new(
                r#"(?i)(?:@import|expression\s*\(|behavior\s*:|javascript:|\\00|\\ff)"#
            ).unwrap(),

            // XML entities (XXE attacks)
            entity_regex: Regex::new(
                r"(?i)<!ENTITY\s+\w+\s+(?:SYSTEM|PUBLIC)"
            ).unwrap(),

            // Use tags with external references
            use_tag_regex: Regex::new(
                r#"(?i)<use[^>]*(?:xlink:)?href\s*=\s*["'](?:https?://|//|data:)[^"']*["']"#
            ).unwrap(),

            // Embedded iframes
            iframe_regex: Regex::new(
                r"(?i)<iframe[^>]*>"
            ).unwrap(),

            // Base64 encoded JavaScript
            base64_js_regex: Regex::new(
                r#"(?i)base64[^"']*(?:PHNjcmlwdD|amF2YXNjcmlwdA|b25sb2Fk|b25lcnJvcg)"#
            ).unwrap(),
        }
    }

    /// Detect script injection
    fn detect_script_injection(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Direct script tags
        for mat in self.script_tag_regex.find_iter(content) {
            let preview = &mat.as_str()[..mat.as_str().len().min(100)];
            findings.push(Finding {
                finding_type: "svg_script_tag".to_string(),
                value: json!({
                    "preview": preview,
                    "length": mat.as_str().len()
                }),
                confidence: 0.99,
                location: path.display().to_string(),
                severity: Severity::Critical,
                metadata: json!({
                    "pattern": "SVG script injection",
                    "description": "Embedded <script> tag in SVG - direct JavaScript execution"
                }),
            });
        }

        // Event handlers
        for cap in self.event_handler_regex.captures_iter(content) {
            let handler = &cap[1];
            findings.push(Finding {
                finding_type: "svg_event_handler".to_string(),
                value: json!({
                    "handler": handler,
                    "full_match": cap.get(0).map(|m| m.as_str()).unwrap_or("")
                }),
                confidence: 0.95,
                location: path.display().to_string(),
                severity: Severity::Critical,
                metadata: json!({
                    "pattern": "SVG event handler injection",
                    "description": format!("{} event handler can execute JavaScript", handler)
                }),
            });
        }

        findings
    }

    /// Detect external resource loading
    fn detect_external_resources(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // xlink:href with javascript: or external URLs
        for mat in self.xlink_regex.find_iter(content) {
            let is_javascript = mat.as_str().to_lowercase().contains("javascript:");

            findings.push(Finding {
                finding_type: if is_javascript {
                    "svg_javascript_href".to_string()
                } else {
                    "svg_external_href".to_string()
                },
                value: json!({
                    "href": mat.as_str()
                }),
                confidence: if is_javascript { 0.99 } else { 0.8 },
                location: path.display().to_string(),
                severity: if is_javascript { Severity::Critical } else { Severity::High },
                metadata: json!({
                    "pattern": if is_javascript {
                        "JavaScript in href attribute"
                    } else {
                        "External resource reference"
                    },
                    "description": if is_javascript {
                        "javascript: URI in href - direct code execution"
                    } else {
                        "External URL in SVG - potential data exfiltration or SSRF"
                    }
                }),
            });
        }

        // Use tags with external references
        for mat in self.use_tag_regex.find_iter(content) {
            findings.push(Finding {
                finding_type: "svg_external_use".to_string(),
                value: json!({
                    "tag": mat.as_str()
                }),
                confidence: 0.85,
                location: path.display().to_string(),
                severity: Severity::High,
                metadata: json!({
                    "pattern": "SVG use tag with external reference",
                    "description": "External SVG inclusion - can load malicious content"
                }),
            });
        }

        findings
    }

    /// Detect data URI payloads
    fn detect_data_uri(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        for mat in self.data_uri_regex.find_iter(content) {
            let uri = mat.as_str();
            let is_html = uri.to_lowercase().contains("text/html");
            let is_js = uri.to_lowercase().contains("javascript");
            let is_svg = uri.to_lowercase().contains("svg+xml");

            let severity = if is_js || is_html {
                Severity::Critical
            } else if is_svg {
                Severity::High
            } else {
                Severity::Medium
            };

            findings.push(Finding {
                finding_type: "svg_data_uri".to_string(),
                value: json!({
                    "uri_preview": &uri[..uri.len().min(100)],
                    "type": if is_js { "javascript" } else if is_html { "html" } else if is_svg { "nested_svg" } else { "other" }
                }),
                confidence: 0.9,
                location: path.display().to_string(),
                severity,
                metadata: json!({
                    "pattern": "Data URI in SVG",
                    "description": format!(
                        "Embedded data URI ({}) - potential payload delivery",
                        if is_js { "JavaScript" } else if is_html { "HTML" } else if is_svg { "nested SVG" } else { "unknown type" }
                    )
                }),
            });
        }

        // Check for base64 encoded JavaScript patterns
        for mat in self.base64_js_regex.find_iter(content) {
            findings.push(Finding {
                finding_type: "svg_base64_js".to_string(),
                value: json!({
                    "pattern": mat.as_str()
                }),
                confidence: 0.95,
                location: path.display().to_string(),
                severity: Severity::Critical,
                metadata: json!({
                    "pattern": "Base64 encoded JavaScript",
                    "description": "Detected base64-encoded script/event handler signatures"
                }),
            });
        }

        findings
    }

    /// Detect foreignObject exploits
    fn detect_foreign_object(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        for mat in self.foreign_object_regex.find_iter(content) {
            let inner = mat.as_str();
            let has_script = inner.to_lowercase().contains("<script");
            let has_iframe = inner.to_lowercase().contains("<iframe");
            let has_form = inner.to_lowercase().contains("<form");

            let severity = if has_script || has_iframe {
                Severity::Critical
            } else if has_form {
                Severity::High
            } else {
                Severity::Medium
            };

            findings.push(Finding {
                finding_type: "svg_foreign_object".to_string(),
                value: json!({
                    "length": inner.len(),
                    "has_script": has_script,
                    "has_iframe": has_iframe,
                    "has_form": has_form,
                    "preview": &inner[..inner.len().min(200)]
                }),
                confidence: if has_script || has_iframe { 0.99 } else { 0.75 },
                location: path.display().to_string(),
                severity,
                metadata: json!({
                    "pattern": "SVG foreignObject element",
                    "description": format!(
                        "foreignObject allows embedding HTML{}",
                        if has_script { " - CONTAINS SCRIPT" } else if has_iframe { " - CONTAINS IFRAME" } else { "" }
                    )
                }),
            });
        }

        findings
    }

    /// Detect CSS injection
    fn detect_css_injection(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        for mat in self.css_injection_regex.find_iter(content) {
            findings.push(Finding {
                finding_type: "svg_css_injection".to_string(),
                value: json!({
                    "pattern": mat.as_str()
                }),
                confidence: 0.85,
                location: path.display().to_string(),
                severity: Severity::High,
                metadata: json!({
                    "pattern": "CSS injection in SVG",
                    "description": "Malicious CSS pattern that may execute code or exfiltrate data"
                }),
            });
        }

        findings
    }

    /// Detect XXE (XML External Entity) attacks
    fn detect_xxe(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        for mat in self.entity_regex.find_iter(content) {
            findings.push(Finding {
                finding_type: "svg_xxe".to_string(),
                value: json!({
                    "entity": mat.as_str()
                }),
                confidence: 0.95,
                location: path.display().to_string(),
                severity: Severity::Critical,
                metadata: json!({
                    "pattern": "XML External Entity (XXE)",
                    "description": "SYSTEM/PUBLIC entity declaration - potential file disclosure or SSRF"
                }),
            });
        }

        findings
    }

    /// Detect embedded iframes
    fn detect_iframes(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        for mat in self.iframe_regex.find_iter(content) {
            findings.push(Finding {
                finding_type: "svg_iframe".to_string(),
                value: json!({
                    "tag": mat.as_str()
                }),
                confidence: 0.95,
                location: path.display().to_string(),
                severity: Severity::Critical,
                metadata: json!({
                    "pattern": "Iframe in SVG",
                    "description": "Embedded iframe - can load arbitrary external content"
                }),
            });
        }

        findings
    }

    /// Check if file is an SVG
    fn is_svg_file(&self, path: &Path, content: &str) -> bool {
        // Check extension
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ext == "svg" {
            return true;
        }

        // Check content for SVG signature
        content.trim_start().starts_with("<?xml") && content.contains("<svg")
            || content.trim_start().starts_with("<svg")
    }

    /// Analyze a single file
    fn analyze_file(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        if let Ok(content) = fs::read_to_string(path) {
            // Only analyze if it's an SVG
            if !self.is_svg_file(path, &content) {
                return findings;
            }

            findings.extend(self.detect_script_injection(path, &content));
            findings.extend(self.detect_external_resources(path, &content));
            findings.extend(self.detect_data_uri(path, &content));
            findings.extend(self.detect_foreign_object(path, &content));
            findings.extend(self.detect_css_injection(path, &content));
            findings.extend(self.detect_xxe(path, &content));
            findings.extend(self.detect_iframes(path, &content));
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

impl Default for SvgDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Skill for SvgDetector {
    fn name(&self) -> &str {
        "detect_svg_injection"
    }

    fn description(&self) -> &str {
        "Detects malicious patterns in SVG files including embedded JavaScript, \
         event handlers, external resource loading, data URIs, foreignObject exploits, \
         CSS injection, and XXE attacks."
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

    fn confidence_threshold(&self) -> f32 {
        0.7
    }

    fn categories(&self) -> Vec<&str> {
        vec!["svg", "xss", "injection", "web_security"]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_script_detection() {
        let detector = SvgDetector::new();
        let malicious_svg = r#"<svg><script>alert('xss')</script></svg>"#;

        // This would need a temp file in real tests
        assert!(detector.script_tag_regex.is_match(malicious_svg));
    }

    #[test]
    fn test_event_handler_detection() {
        let detector = SvgDetector::new();
        let malicious_svg = r#"<svg onload="alert('xss')"></svg>"#;

        assert!(detector.event_handler_regex.is_match(malicious_svg));
    }

    #[test]
    fn test_javascript_href() {
        let detector = SvgDetector::new();
        let malicious_svg = r#"<svg><a href="javascript:alert('xss')">click</a></svg>"#;

        assert!(detector.xlink_regex.is_match(malicious_svg));
    }
}
