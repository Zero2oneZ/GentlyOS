//! Audio Channel Detector
//!
//! Detects audio-based covert channels:
//! - Ultrasonic communication patterns
//! - Audio steganography indicators
//! - Microphone access patterns
//! - Sound-based data exfiltration

use crate::skills::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct AudioDetector {
    audio_api_regex: Regex,
    frequency_regex: Regex,
    mic_regex: Regex,
}

impl AudioDetector {
    pub fn new() -> Self {
        Self {
            // Audio API usage
            audio_api_regex: Regex::new(
                r"(?i)\b(AudioContext|WebAudio|createOscillator|createAnalyser|getUserMedia|mediaDevices)\b"
            ).unwrap(),
            // High/ultrasonic frequencies
            frequency_regex: Regex::new(r"\b(1[89]\d{3}|2[0-4]\d{3})\b").unwrap(),  // 18000-24000 Hz
            // Microphone access
            mic_regex: Regex::new(
                r"(?i)\b(microphone|audio.*input|record.*audio|MediaRecorder)\b"
            ).unwrap(),
        }
    }

    /// Detect ultrasonic frequency usage
    fn detect_ultrasonic(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Check for Web Audio API usage
        let audio_matches: Vec<&str> = self.audio_api_regex
            .find_iter(content)
            .map(|m| m.as_str())
            .collect();

        if !audio_matches.is_empty() {
            // Look for ultrasonic frequencies (18-24 kHz)
            let freq_matches: Vec<&str> = self.frequency_regex
                .find_iter(content)
                .map(|m| m.as_str())
                .collect();

            if !freq_matches.is_empty() {
                findings.push(Finding {
                    finding_type: "ultrasonic_frequency".to_string(),
                    value: json!({
                        "audio_apis": audio_matches,
                        "frequencies": freq_matches
                    }),
                    confidence: 0.8,
                    location: path.display().to_string(),
                    severity: Severity::High,
                    metadata: json!({
                        "pattern": "Ultrasonic frequency usage",
                        "description": format!("Audio API with ultrasonic frequencies: {:?}", freq_matches)
                    }),
                });
            }
        }

        findings
    }

    /// Detect microphone access patterns
    fn detect_mic_access(&self, path: &Path, content: &str) -> Vec<Finding> {
        let mut findings = Vec::new();

        let mic_matches: Vec<&str> = self.mic_regex
            .find_iter(content)
            .map(|m| m.as_str())
            .collect();

        if !mic_matches.is_empty() {
            // Check if there's also network activity (data exfiltration)
            let network_keywords = Regex::new(r"(?i)\b(fetch|XMLHttpRequest|WebSocket|send)\b").unwrap();
            let has_network = network_keywords.is_match(content);

            let severity = if has_network { Severity::Critical } else { Severity::Medium };
            let confidence = if has_network { 0.85 } else { 0.6 };

            findings.push(Finding {
                finding_type: "microphone_access".to_string(),
                value: json!({
                    "keywords": mic_matches,
                    "has_network": has_network
                }),
                confidence,
                location: path.display().to_string(),
                severity,
                metadata: json!({
                    "pattern": "Microphone access",
                    "description": if has_network {
                        "Microphone access with network capability - potential audio exfiltration"
                    } else {
                        "Microphone access detected"
                    }
                }),
            });
        }

        findings
    }

    /// Detect audio file manipulation
    fn detect_audio_manipulation(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Check if file is an audio file by extension
        let extension = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ["wav", "mp3", "ogg", "flac", "aac"].contains(&extension.as_str()) {
            if let Ok(data) = fs::read(path) {
                // Check for unusual patterns in audio data

                // WAV files: check for anomalies
                if extension == "wav" && data.len() > 44 {
                    // Check if data section has unusual patterns
                    let data_section = &data[44..];

                    // Count zero runs (could indicate hidden data)
                    let mut zero_runs = 0;
                    let mut current_run = 0;
                    for &byte in data_section.iter().take(10000) {
                        if byte == 0 {
                            current_run += 1;
                        } else {
                            if current_run > 100 {
                                zero_runs += 1;
                            }
                            current_run = 0;
                        }
                    }

                    if zero_runs > 5 {
                        findings.push(Finding {
                            finding_type: "audio_anomaly".to_string(),
                            value: json!({
                                "file_type": "WAV",
                                "zero_runs": zero_runs
                            }),
                            confidence: 0.65,
                            location: path.display().to_string(),
                            severity: Severity::Medium,
                            metadata: json!({
                                "pattern": "Audio file anomaly",
                                "description": format!("WAV file has {} unusual zero-byte runs", zero_runs)
                            }),
                        });
                    }
                }
            }
        }

        findings
    }

    /// Analyze a single file
    fn analyze_file(&self, path: &Path) -> Vec<Finding> {
        let mut findings = Vec::new();

        // Check audio files for anomalies
        findings.extend(self.detect_audio_manipulation(path));

        // Check code files for audio API usage
        if let Ok(content) = fs::read_to_string(path) {
            findings.extend(self.detect_ultrasonic(path, &content));
            findings.extend(self.detect_mic_access(path, &content));
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

impl Default for AudioDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Skill for AudioDetector {
    fn name(&self) -> &str {
        "detect_audio_channels"
    }

    fn description(&self) -> &str {
        "Detects audio-based covert channels including ultrasonic communication, \
         microphone access patterns, and audio file anomalies."
    }

    fn schema(&self) -> Value {
        schema::skill_schema(
            self.name(),
            self.description(),
            json!({
                "path": schema::string_param("File or directory to scan"),
                "recursive": schema::bool_param("Scan directories recursively", true),
                "analyze_audio_files": schema::bool_param("Analyze audio file contents", true)
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
        vec!["audio", "covert_channel", "exfiltration"]
    }
}
