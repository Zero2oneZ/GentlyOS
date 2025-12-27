//! GentlyOS Firewall CLI
//!
//! Security scanning tool with ML-trainable detection skills.

use clap::{Parser, Subcommand};
use colored::Colorize;
use firewall_core::{create_default_registry, export_tool_schemas, scan_path, Severity};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "firewall")]
#[command(author = "GentlyOS Team")]
#[command(version)]
#[command(about = "GentlyOS Firewall - ML-trainable security detection", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Scan a file or directory for threats
    Scan {
        /// Path to scan
        path: PathBuf,

        /// Output format (text, json)
        #[arg(short, long, default_value = "text")]
        format: String,

        /// Run specific skill only
        #[arg(short, long)]
        skill: Option<String>,

        /// Minimum severity to report (info, low, medium, high, critical)
        #[arg(long, default_value = "low")]
        min_severity: String,
    },

    /// List available detection skills
    Skills {
        /// Show detailed info
        #[arg(short, long)]
        verbose: bool,
    },

    /// Export skill schemas for ML training
    Export {
        /// Output file (stdout if not specified)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Format (openai, anthropic, mcp)
        #[arg(short, long, default_value = "openai")]
        format: String,
    },

    /// Invoke a specific skill
    Invoke {
        /// Skill name
        skill: String,

        /// Path to analyze
        path: PathBuf,

        /// Additional JSON parameters
        #[arg(short, long)]
        params: Option<String>,
    },
}

fn severity_color(severity: &Severity) -> colored::ColoredString {
    match severity {
        Severity::Critical => "CRITICAL".red().bold(),
        Severity::High => "HIGH".red(),
        Severity::Medium => "MEDIUM".yellow(),
        Severity::Low => "LOW".blue(),
        Severity::Info => "INFO".white(),
    }
}

fn parse_min_severity(s: &str) -> Severity {
    match s.to_lowercase().as_str() {
        "critical" => Severity::Critical,
        "high" => Severity::High,
        "medium" => Severity::Medium,
        "low" => Severity::Low,
        _ => Severity::Info,
    }
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Scan {
            path,
            format,
            skill,
            min_severity,
        } => {
            let min_sev = parse_min_severity(&min_severity);

            println!();
            println!("{}", "╔══════════════════════════════════════════════════════════════════╗".cyan());
            println!("{}", "║             GentlyOS FIREWALL - Security Scan                    ║".cyan());
            println!("{}", "║             Zero Trust: If we didn't build it, it's a threat.    ║".cyan());
            println!("{}", "╚══════════════════════════════════════════════════════════════════╝".cyan());
            println!();

            let path_str = path.display().to_string();

            if let Some(skill_name) = skill {
                // Run specific skill
                let registry = create_default_registry();
                let params = serde_json::json!({ "path": path_str });

                match registry.invoke(&skill_name, params) {
                    Ok(output) => {
                        let filtered: Vec<_> = output
                            .findings
                            .into_iter()
                            .filter(|f| f.severity >= min_sev)
                            .collect();

                        if format == "json" {
                            println!("{}", serde_json::to_string_pretty(&filtered).unwrap());
                        } else {
                            print_findings(&filtered);
                        }
                    }
                    Err(e) => {
                        eprintln!("{}: {}", "Error".red(), e);
                    }
                }
            } else {
                // Run all skills
                match scan_path(&path_str) {
                    Ok(findings) => {
                        let filtered: Vec<_> = findings
                            .into_iter()
                            .filter(|f| f.severity >= min_sev)
                            .collect();

                        if format == "json" {
                            println!("{}", serde_json::to_string_pretty(&filtered).unwrap());
                        } else {
                            print_findings(&filtered);
                        }
                    }
                    Err(e) => {
                        eprintln!("{}: {}", "Error".red(), e);
                    }
                }
            }
        }

        Commands::Skills { verbose } => {
            let registry = create_default_registry();

            println!();
            println!("{}", "Available Detection Skills:".green().bold());
            println!();

            for name in registry.list() {
                if let Some(skill) = registry.get(name) {
                    println!("  {} {}", "●".cyan(), name.white().bold());

                    if verbose {
                        println!("    {}", skill.description().dimmed());
                        println!("    Categories: {:?}", skill.categories());
                        println!();
                    }
                }
            }

            if !verbose {
                println!();
                println!("Use --verbose for detailed descriptions");
            }
        }

        Commands::Export { output, format: _ } => {
            let schemas = export_tool_schemas();
            let json = serde_json::to_string_pretty(&schemas).unwrap();

            match output {
                Some(path) => {
                    std::fs::write(&path, &json).expect("Failed to write file");
                    println!("Schemas exported to: {}", path.display());
                }
                None => {
                    println!("{}", json);
                }
            }
        }

        Commands::Invoke {
            skill,
            path,
            params,
        } => {
            let registry = create_default_registry();

            let mut json_params = serde_json::json!({
                "path": path.display().to_string()
            });

            if let Some(extra) = params {
                if let Ok(extra_json) = serde_json::from_str::<serde_json::Value>(&extra) {
                    if let Some(obj) = extra_json.as_object() {
                        for (k, v) in obj {
                            json_params[k] = v.clone();
                        }
                    }
                }
            }

            match registry.invoke(&skill, json_params) {
                Ok(output) => {
                    println!("{}", serde_json::to_string_pretty(&output).unwrap());
                }
                Err(e) => {
                    eprintln!("{}: {}", "Error".red(), e);
                }
            }
        }
    }
}

fn print_findings(findings: &[firewall_core::Finding]) {
    if findings.is_empty() {
        println!("{}", "✓ No threats detected".green());
        return;
    }

    println!(
        "Found {} {}:",
        findings.len().to_string().yellow().bold(),
        if findings.len() == 1 {
            "finding"
        } else {
            "findings"
        }
    );
    println!();

    for finding in findings {
        println!(
            "  [{}] {}",
            severity_color(&finding.severity),
            finding.finding_type.white().bold()
        );
        println!("    Location: {}", finding.location.dimmed());
        println!("    Confidence: {:.0}%", finding.confidence * 100.0);

        if let Some(desc) = finding.metadata.get("description") {
            if let Some(s) = desc.as_str() {
                println!("    {}", s);
            }
        }

        println!();
    }

    // Summary
    let critical = findings.iter().filter(|f| f.severity == Severity::Critical).count();
    let high = findings.iter().filter(|f| f.severity == Severity::High).count();

    if critical > 0 || high > 0 {
        println!(
            "{}",
            format!(
                "⚠ {} critical, {} high severity findings",
                critical, high
            )
            .red()
            .bold()
        );
    }
}
