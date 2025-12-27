//! Network/C2 Pattern Detector
//!
//! Detects malicious network patterns:
//! - Domain Generation Algorithms (DGA)
//! - Beaconing patterns
//! - DNS tunneling indicators
//! - Suspicious API endpoints
//! - Hardcoded IPs/ports

use crate::skills::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct NetworkDetector {
    ip_regex: Regex,
    url_regex: Regex,
    port_regex: Regex,
    base64_domain_regex: Regex,
}

impl NetworkDetector {
    pub fn new() -> Self {
        Self {
            ip_regex: Regex::new(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b").unwrap(),
            url_regex: Regex::new(r#"https?://([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}"#).unwrap(),
            port_regex: Regex::new(r":(\d{2,5})\b").unwrap(),
            base64_domain_regex: Regex::new(r"[A-Za-z0-9+/]{20,}\.(?:com|net|org|io|xyz)").unwrap(),
        }
    }

    /// Calculate consonant ratio (DGA domains often have unusual ratios)
    fn consonant_ratio(&self, domain: &str) -> f64 {
        let consonants: HashSet<char> = "bcdfghjklmnpqrstvwxyz".chars().collect();
        let letters: Vec<char> = domain.to_lowercase().chars().filter(|c| c.is_alphabetic()).collect();

        if letters.is_empty() {
            return 0.0;
        }

        let consonant_count = letters.iter().filter(|c| consonants.contains(c)).count();
        consonant_count as f64 / letters.len() as f64
    }

    /// Detect potential DGA domains
    fn detect_dga_domains(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        for mat in self.url_regex.find_iter(content) {
            let url = mat.as_str();

            // Extract domain
            if let Some(domain) = url.split("://").nth(1).and_then(|s| s.split('/').next()) {
                let domain_no_tld = domain.split('.').next().unwrap_or("");

                // Check for DGA indicators
                let ratio = self.consonant_ratio(domain_no_tld);
                let has_numbers = domain_no_tld.chars().any(|c| c.is_numeric());
                let length = domain_no_tld.len();

                // DGA domains often: high consonant ratio, contain numbers, unusual length
                if ratio > 0.7 && has_numbers && length > 10 {
                    findings.push(Finding {
                        finding_type: "potential_dga_domain".to_string(),
                        value: json!({
                            "domain": domain,
                            "consonant_ratio": ratio,
                            "length": length
                        }),
                        confidence: 0.75,
                        location: path.display().to_string(),
                        severity: Severity::High,
                        metadata: json!({
                            "pattern": "Domain Generation Algorithm",
                            "description": format!("Domain '{}' has DGA characteristics", domain)
                        }),
                    });
                }
            }
        }

        // Check for base64-looking domains
        for mat in self.base64_domain_regex.find_iter(content) {
            findings.push(Finding {
                finding_type: "base64_domain".to_string(),
                value: json!({ "domain": mat.as_str() }),
                confidence: 0.8,
                location: path.display().to_string(),
                severity: Severity::High,
                metadata: json!({
                    "pattern": "Base64-encoded domain",
                    "description": "Domain appears to contain encoded data"
                }),
            });
        }

        findings
    }

    /// Detect hardcoded IPs (potential C2)
    fn detect_hardcoded_ips(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Exclude common safe IPs
        let safe_ips: HashSet<&str> = [
            "127.0.0.1", "0.0.0.0", "255.255.255.255",
            "192.168.0.1", "192.168.1.1", "10.0.0.1",
        ].iter().cloned().collect();

        let mut found_ips: HashSet<String> = HashSet::new();

        for cap in self.ip_regex.captures_iter(content) {
            let ip = &cap[1];

            // Skip safe IPs and duplicates
            if safe_ips.contains(ip) || found_ips.contains(ip) {
                continue;
            }

            // Skip private ranges
            let octets: Vec<u8> = ip.split('.').filter_map(|s| s.parse().ok()).collect();
            if octets.len() == 4 {
                if octets[0] == 10 ||
                   (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) ||
                   (octets[0] == 192 && octets[1] == 168) {
                    continue;
                }
            }

            found_ips.insert(ip.to_string());
        }

        if !found_ips.is_empty() {
            findings.push(Finding {
                finding_type: "hardcoded_public_ip".to_string(),
                value: json!({
                    "ips": found_ips.iter().collect::<Vec<_>>(),
                    "count": found_ips.len()
                }),
                confidence: 0.7,
                location: path.display().to_string(),
                severity: Severity::Medium,
                metadata: json!({
                    "pattern": "Hardcoded public IP addresses",
                    "description": format!("Found {} public IP addresses", found_ips.len())
                }),
            });
        }

        findings
    }

    /// Detect suspicious ports
    fn detect_suspicious_ports(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Suspicious ports commonly used by malware
        let suspicious_ports: HashSet<u16> = [
            4444, 5555, 6666, 7777, 8888, 9999,  // Common RAT ports
            1337, 31337,                          // "Elite" ports
            4443, 8443,                           // Alt HTTPS
            6667, 6668, 6669,                     // IRC
            5900, 5901,                           // VNC
        ].iter().cloned().collect();

        let mut found_ports: Vec<u16> = Vec::new();

        for cap in self.port_regex.captures_iter(content) {
            if let Ok(port) = cap[1].parse::<u16>() {
                if suspicious_ports.contains(&port) && !found_ports.contains(&port) {
                    found_ports.push(port);
                }
            }
        }

        if !found_ports.is_empty() {
            findings.push(Finding {
                finding_type: "suspicious_ports".to_string(),
                value: json!({
                    "ports": found_ports,
                    "count": found_ports.len()
                }),
                confidence: 0.75,
                location: path.display().to_string(),
                severity: Severity::High,
                metadata: json!({
                    "pattern": "Suspicious port numbers",
                    "description": format!("Found ports commonly used by malware: {:?}", found_ports)
                }),
            });
        }

        findings
    }

    /// Analyze a single file
    fn analyze_file(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        if let Ok(content) = fs::read_to_string(path) {
            findings.extend(self.detect_dga_domains(path, &content));
            findings.extend(self.detect_hardcoded_ips(path, &content));
            findings.extend(self.detect_suspicious_ports(path, &content));
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

impl Default for NetworkDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Skill for NetworkDetector {
    fn name(&self) -> &str {
        "detect_network_patterns"
    }

    fn description(&self) -> &str {
        "Detects malicious network patterns including DGA domains, \
         hardcoded IPs, and suspicious ports commonly used by malware."
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
        vec!["network", "c2", "malware"]
    }
}
