//! Skill Registry - discovers and manages available skills

use super::r#trait::{Skill, SkillError, SkillOutput, SkillResult};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

/// Registry of all available skills
pub struct SkillRegistry {
    skills: HashMap<String, Arc<dyn Skill>>,
}

impl SkillRegistry {
    pub fn new() -> Self {
        Self {
            skills: HashMap::new(),
        }
    }

    /// Register a skill
    pub fn register<S: Skill + 'static>(&mut self, skill: S) {
        let name = skill.name().to_string();
        self.skills.insert(name, Arc::new(skill));
    }

    /// Get a skill by name
    pub fn get(&self, name: &str) -> Option<Arc<dyn Skill>> {
        self.skills.get(name).cloned()
    }

    /// List all registered skill names
    pub fn list(&self) -> Vec<&str> {
        self.skills.keys().map(|s| s.as_str()).collect()
    }

    /// Get all skill schemas for tool calling
    pub fn schemas(&self) -> Vec<Value> {
        self.skills.values().map(|s| s.schema()).collect()
    }

    /// Invoke a skill by name
    pub fn invoke(&self, name: &str, params: Value) -> SkillResult<SkillOutput> {
        match self.skills.get(name) {
            Some(skill) => skill.execute(params),
            None => Err(SkillError::InvalidParams(format!(
                "Unknown skill: {}",
                name
            ))),
        }
    }

    /// Run all skills on a target path
    pub fn scan_all(&self, path: &str) -> Vec<(String, SkillResult<SkillOutput>)> {
        let params = serde_json::json!({ "path": path });

        self.skills
            .iter()
            .map(|(name, skill)| (name.clone(), skill.execute(params.clone())))
            .collect()
    }

    /// Get skills by category
    pub fn by_category(&self, category: &str) -> Vec<Arc<dyn Skill>> {
        self.skills
            .values()
            .filter(|s| s.categories().contains(&category))
            .cloned()
            .collect()
    }

    /// Export all schemas as JSON for ML training
    pub fn export_schemas(&self) -> Value {
        serde_json::json!({
            "skills": self.schemas(),
            "version": "1.0",
            "format": "openai_function_calling"
        })
    }
}

impl Default for SkillRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a registry with all built-in skills
pub fn create_default_registry() -> SkillRegistry {
    use crate::detectors::*;

    let mut registry = SkillRegistry::new();

    // Register all detectors
    registry.register(cipher::CipherDetector::new());
    registry.register(stego::StegoDetector::new());
    registry.register(obfuscation::ObfuscationDetector::new());
    registry.register(network::NetworkDetector::new());
    registry.register(temporal::TemporalDetector::new());
    registry.register(audio::AudioDetector::new());
    registry.register(injection::InjectionDetector::new());
    registry.register(svg::SvgDetector::new());
    registry.register(filesystem::FilesystemDetector::new());

    registry
}
