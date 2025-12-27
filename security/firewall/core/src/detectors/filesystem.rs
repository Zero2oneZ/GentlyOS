//! Filesystem Security Detector
//!
//! Detects filesystem-based attack patterns:
//! - Recursive/circular symlink attacks
//! - Hidden root-level files (dotfiles in /)
//! - Exposed .git directories
//! - Screenshot collection (spyware indicator)
//! - Suspicious hidden directories
//! - Path traversal attempts
//! - Sensitive file exposure

use crate::skills::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct FilesystemDetector {
    screenshot_regex: Regex,
    sensitive_files: Vec<&'static str>,
    git_sensitive: Vec<&'static str>,
}

impl FilesystemDetector {
    pub fn new() -> Self {
        Self {
            // Screenshot file patterns
            screenshot_regex: Regex::new(
                r"(?i)(screenshot|screen.?shot|screen.?cap|capture|scrn|desktop.?\d|display.?\d)\.(png|jpg|jpeg|bmp|gif|webp)$"
            ).unwrap(),

            // Sensitive files that shouldn't be exposed
            sensitive_files: vec![
                ".env",
                ".env.local",
                ".env.production",
                "credentials.json",
                "secrets.yaml",
                "secrets.yml",
                ".aws/credentials",
                ".ssh/id_rsa",
                ".ssh/id_ed25519",
                ".npmrc",
                ".pypirc",
                "wp-config.php",
                "config.php",
                ".htpasswd",
                "shadow",
                "passwd",
            ],

            // Sensitive files within .git
            git_sensitive: vec![
                "config",
                "COMMIT_EDITMSG",
                "HEAD",
                "index",
                "objects",
                "refs",
            ],
        }
    }

    /// Detect recursive/circular symlinks
    fn detect_symlink_attacks(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();
        let mut visited: HashSet<PathBuf> = HashSet::new();

        for entry in WalkDir::new(path)
            .follow_links(false)
            .max_depth(10)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let entry_path = entry.path();

            // Check if it's a symlink
            if entry_path.is_symlink() {
                match fs::read_link(entry_path) {
                    Ok(target) => {
                        // Resolve the target
                        let absolute_target = if target.is_absolute() {
                            target.clone()
                        } else {
                            entry_path.parent()
                                .unwrap_or(Path::new("/"))
                                .join(&target)
                        };

                        // Check for self-reference
                        if absolute_target == entry_path {
                            findings.push(Finding {
                                finding_type: "symlink_self_reference".to_string(),
                                value: json!({
                                    "path": entry_path.display().to_string(),
                                    "target": target.display().to_string()
                                }),
                                confidence: 0.99,
                                location: entry_path.display().to_string(),
                                severity: Severity::High,
                                metadata: json!({
                                    "pattern": "Self-referencing symlink",
                                    "description": "Symlink points to itself - causes infinite loops"
                                }),
                            });
                        }

                        // Check for circular references
                        if let Ok(canonical) = fs::canonicalize(&absolute_target) {
                            if visited.contains(&canonical) {
                                findings.push(Finding {
                                    finding_type: "symlink_circular".to_string(),
                                    value: json!({
                                        "path": entry_path.display().to_string(),
                                        "target": target.display().to_string(),
                                        "resolves_to": canonical.display().to_string()
                                    }),
                                    confidence: 0.95,
                                    location: entry_path.display().to_string(),
                                    severity: Severity::High,
                                    metadata: json!({
                                        "pattern": "Circular symlink chain",
                                        "description": "Symlink creates a loop in directory traversal"
                                    }),
                                });
                            }
                        }

                        // Check for symlinks pointing outside the scanned directory
                        if let Ok(canonical) = fs::canonicalize(&absolute_target) {
                            if let Ok(base_canonical) = fs::canonicalize(path) {
                                if !canonical.starts_with(&base_canonical) {
                                    // Check if pointing to sensitive locations
                                    let target_str = canonical.display().to_string();
                                    let is_sensitive = target_str.starts_with("/etc")
                                        || target_str.starts_with("/root")
                                        || target_str.starts_with("/home")
                                        || target_str.contains("/.ssh")
                                        || target_str.contains("/.aws");

                                    if is_sensitive {
                                        findings.push(Finding {
                                            finding_type: "symlink_escape".to_string(),
                                            value: json!({
                                                "path": entry_path.display().to_string(),
                                                "target": canonical.display().to_string()
                                            }),
                                            confidence: 0.9,
                                            location: entry_path.display().to_string(),
                                            severity: Severity::Critical,
                                            metadata: json!({
                                                "pattern": "Symlink directory escape",
                                                "description": "Symlink points to sensitive location outside scanned directory"
                                            }),
                                        });
                                    }
                                }
                            }
                        }
                    }
                    Err(_) => {
                        // Broken symlink
                        findings.push(Finding {
                            finding_type: "symlink_broken".to_string(),
                            value: json!({
                                "path": entry_path.display().to_string()
                            }),
                            confidence: 0.7,
                            location: entry_path.display().to_string(),
                            severity: Severity::Low,
                            metadata: json!({
                                "pattern": "Broken symlink",
                                "description": "Symlink target does not exist"
                            }),
                        });
                    }
                }

                if let Ok(canonical) = fs::canonicalize(entry_path) {
                    visited.insert(canonical);
                }
            }
        }

        findings
    }

    /// Detect hidden files in root or sensitive locations
    fn detect_hidden_root(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Check for dotfiles in the scanned directory root
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();

                if name_str.starts_with('.') && name_str != "." && name_str != ".." {
                    // Check if it's a suspicious hidden file
                    let suspicious = name_str == ".bashrc"
                        || name_str == ".profile"
                        || name_str == ".bash_profile"
                        || name_str == ".zshrc"
                        || name_str == ".vimrc"
                        || name_str.contains("rc")
                        || name_str.contains("history")
                        || name_str.contains("secret")
                        || name_str.contains("credential")
                        || name_str.contains("token")
                        || name_str.contains("key");

                    if suspicious {
                        findings.push(Finding {
                            finding_type: "hidden_sensitive_file".to_string(),
                            value: json!({
                                "name": name_str,
                                "path": entry.path().display().to_string()
                            }),
                            confidence: 0.8,
                            location: entry.path().display().to_string(),
                            severity: Severity::Medium,
                            metadata: json!({
                                "pattern": "Hidden sensitive file",
                                "description": format!("Hidden file '{}' may contain sensitive data", name_str)
                            }),
                        });
                    }
                }
            }
        }

        findings
    }

    /// Detect exposed .git directories
    fn detect_git_exposure(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        for entry in WalkDir::new(path)
            .max_depth(5)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let entry_path = entry.path();

            if entry_path.ends_with(".git") && entry_path.is_dir() {
                // Check what sensitive files exist
                let mut exposed_files = Vec::new();

                for sensitive in &self.git_sensitive {
                    let check_path = entry_path.join(sensitive);
                    if check_path.exists() {
                        exposed_files.push(sensitive.to_string());
                    }
                }

                // Check for credentials in git config
                let config_path = entry_path.join("config");
                let has_credentials = if let Ok(content) = fs::read_to_string(&config_path) {
                    content.contains("password") || content.contains("token") || content.contains("credential")
                } else {
                    false
                };

                findings.push(Finding {
                    finding_type: "git_directory_exposed".to_string(),
                    value: json!({
                        "path": entry_path.display().to_string(),
                        "exposed_files": exposed_files,
                        "has_credentials": has_credentials
                    }),
                    confidence: 0.95,
                    location: entry_path.display().to_string(),
                    severity: if has_credentials { Severity::Critical } else { Severity::High },
                    metadata: json!({
                        "pattern": "Exposed .git directory",
                        "description": if has_credentials {
                            "Git directory with credentials exposed - source code and secrets at risk"
                        } else {
                            "Git directory exposed - source code disclosure risk"
                        }
                    }),
                });
            }
        }

        findings
    }

    /// Detect screenshot collection (spyware indicator)
    fn detect_screenshot_collection(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();
        let mut screenshots: Vec<String> = Vec::new();
        let mut total_size: u64 = 0;

        for entry in WalkDir::new(path)
            .max_depth(10)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let entry_path = entry.path();

            if let Some(name) = entry_path.file_name() {
                let name_str = name.to_string_lossy();

                if self.screenshot_regex.is_match(&name_str) {
                    screenshots.push(entry_path.display().to_string());

                    if let Ok(meta) = entry_path.metadata() {
                        total_size += meta.len();
                    }
                }
            }
        }

        if screenshots.len() >= 5 {
            // Check if they're in a suspicious directory
            let suspicious_dirs = ["temp", "tmp", ".cache", "hidden", "data", "uploads"];
            let in_suspicious = screenshots.iter().any(|s| {
                suspicious_dirs.iter().any(|d| s.to_lowercase().contains(d))
            });

            findings.push(Finding {
                finding_type: "screenshot_collection".to_string(),
                value: json!({
                    "count": screenshots.len(),
                    "total_size_mb": total_size as f64 / 1_000_000.0,
                    "samples": &screenshots[..screenshots.len().min(5)]
                }),
                confidence: if in_suspicious { 0.9 } else { 0.75 },
                location: path.display().to_string(),
                severity: if screenshots.len() > 20 || in_suspicious {
                    Severity::Critical
                } else {
                    Severity::High
                },
                metadata: json!({
                    "pattern": "Screenshot collection",
                    "description": format!(
                        "Found {} screenshot files ({:.1} MB) - potential spyware/surveillance",
                        screenshots.len(),
                        total_size as f64 / 1_000_000.0
                    )
                }),
            });
        }

        findings
    }

    /// Detect sensitive file exposure
    fn detect_sensitive_files(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        for entry in WalkDir::new(path)
            .max_depth(10)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let entry_path = entry.path();

            if let Some(name) = entry_path.file_name() {
                let name_str = name.to_string_lossy();
                let path_str = entry_path.display().to_string();

                for sensitive in &self.sensitive_files {
                    if name_str == *sensitive || path_str.ends_with(sensitive) {
                        findings.push(Finding {
                            finding_type: "sensitive_file_exposed".to_string(),
                            value: json!({
                                "file": sensitive,
                                "path": path_str
                            }),
                            confidence: 0.95,
                            location: path_str.clone(),
                            severity: Severity::Critical,
                            metadata: json!({
                                "pattern": "Sensitive file exposure",
                                "description": format!("'{}' contains credentials or secrets", sensitive)
                            }),
                        });
                        break;
                    }
                }
            }
        }

        findings
    }

    /// Detect path traversal patterns in filenames
    fn detect_path_traversal(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        for entry in WalkDir::new(path)
            .max_depth(10)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let entry_path = entry.path();

            if let Some(name) = entry_path.file_name() {
                let name_str = name.to_string_lossy();

                // Check for path traversal in filename
                if name_str.contains("..") || name_str.contains("./") || name_str.contains("/.") {
                    findings.push(Finding {
                        finding_type: "path_traversal_filename".to_string(),
                        value: json!({
                            "name": name_str,
                            "path": entry_path.display().to_string()
                        }),
                        confidence: 0.9,
                        location: entry_path.display().to_string(),
                        severity: Severity::High,
                        metadata: json!({
                            "pattern": "Path traversal in filename",
                            "description": "Filename contains directory traversal characters"
                        }),
                    });
                }
            }
        }

        findings
    }

    /// Analyze a path
    fn analyze(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        findings.extend(self.detect_symlink_attacks(path));
        findings.extend(self.detect_hidden_root(path));
        findings.extend(self.detect_git_exposure(path));
        findings.extend(self.detect_screenshot_collection(path));
        findings.extend(self.detect_sensitive_files(path));
        findings.extend(self.detect_path_traversal(path));

        findings
    }
}

impl Default for FilesystemDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Skill for FilesystemDetector {
    fn name(&self) -> &str {
        "detect_filesystem_threats"
    }

    fn description(&self) -> &str {
        "Detects filesystem-based security threats including recursive symlinks, \
         hidden sensitive files, exposed .git directories, screenshot collection \
         (spyware), sensitive file exposure, and path traversal patterns."
    }

    fn schema(&self) -> Value {
        schema::skill_schema(
            self.name(),
            self.description(),
            json!({
                "path": schema::string_param("Directory to scan"),
                "follow_symlinks": schema::bool_param("Follow symlinks during scan", false),
                "max_depth": {
                    "type": "integer",
                    "description": "Maximum directory depth to scan",
                    "default": 10
                }
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

        let findings = self.analyze(path);

        let threshold = self.confidence_threshold();
        let filtered: Vec<Finding> = findings
            .into_iter()
            .filter(|f| f.confidence >= threshold)
            .collect();

        Ok(SkillOutput::with_findings(filtered))
    }

    fn categories(&self) -> Vec<&str> {
        vec!["filesystem", "symlink", "git", "spyware", "exposure"]
    }
}
