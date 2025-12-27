//! Skills module - ML-trainable detection capabilities

mod registry;
mod r#trait;

pub use registry::{create_default_registry, SkillRegistry};
pub use r#trait::{
    schema, Finding, ScanParams, Severity, Skill, SkillError, SkillOutput, SkillResult,
};
