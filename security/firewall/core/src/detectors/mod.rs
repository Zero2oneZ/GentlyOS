//! Detection modules for various threat patterns

pub mod audio;
pub mod cipher;
pub mod filesystem;
pub mod injection;
pub mod network;
pub mod obfuscation;
pub mod stego;
pub mod svg;
pub mod temporal;

pub use audio::AudioDetector;
pub use cipher::CipherDetector;
pub use filesystem::FilesystemDetector;
pub use injection::InjectionDetector;
pub use network::NetworkDetector;
pub use obfuscation::ObfuscationDetector;
pub use stego::StegoDetector;
pub use svg::SvgDetector;
pub use temporal::TemporalDetector;
