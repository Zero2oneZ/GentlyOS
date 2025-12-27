//! GentlyOS Desktop - Tauri/Rust Backend
//!
//! Native Rust implementation providing:
//! - XOR chain generation
//! - Neural graph operations
//! - System tray integration
//! - Native performance

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod xor;
mod graph;

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::sync::Mutex;
use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem, State,
};

// Global state
struct AppState {
    xor_chain: Mutex<Vec<String>>,
    graph_nodes: Mutex<u32>,
    boot_xor: Mutex<String>,
    initialized: Mutex<bool>,
}

#[derive(Serialize, Deserialize)]
struct Interaction {
    #[serde(rename = "type")]
    interaction_type: String,
    action: String,
    prompt: Option<String>,
}

#[derive(Serialize)]
struct ProcessResult {
    response: String,
    xor: String,
    route: String,
}

#[derive(Serialize)]
struct Status {
    initialized: bool,
    mode: String,
    license: String,
    boot_xor: String,
    xor_chain: usize,
    graph_nodes: u32,
}

/// Generate XOR key from state
fn generate_xor(state: &str, previous: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(state.as_bytes());
    let hash = hasher.finalize();

    let state_part = u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]);
    let time_part = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u32;

    let prev_part = previous
        .and_then(|p| u32::from_str_radix(p, 16).ok())
        .unwrap_or(0);

    let xor_value = (state_part ^ time_part ^ prev_part) & 0xFFF;
    format!("{:03X}", xor_value)
}

/// Hash content
fn hash_content(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let hash = hasher.finalize();
    hex::encode(&hash[..16])
}

// Tauri commands

#[tauri::command]
fn initialize(state: State<AppState>) -> Status {
    let boot_state = format!("boot:{}", chrono::Utc::now().timestamp());
    let xor = generate_xor(&boot_state, None);

    *state.boot_xor.lock().unwrap() = xor.clone();
    state.xor_chain.lock().unwrap().push(xor.clone());
    *state.initialized.lock().unwrap() = true;

    println!("[GENTLYOS] Initialized with XOR: {}", xor);

    Status {
        initialized: true,
        mode: "production".to_string(),
        license: "Personal".to_string(),
        boot_xor: xor,
        xor_chain: 1,
        graph_nodes: 0,
    }
}

#[tauri::command]
fn get_status(state: State<AppState>) -> Status {
    Status {
        initialized: *state.initialized.lock().unwrap(),
        mode: "production".to_string(),
        license: "Personal".to_string(),
        boot_xor: state.boot_xor.lock().unwrap().clone(),
        xor_chain: state.xor_chain.lock().unwrap().len(),
        graph_nodes: *state.graph_nodes.lock().unwrap(),
    }
}

#[tauri::command]
fn process_interaction(interaction: Interaction, state: State<AppState>) -> ProcessResult {
    // Generate new XOR
    let chain = state.xor_chain.lock().unwrap();
    let previous = chain.last().map(|s| s.as_str());
    let prompt = interaction.prompt.clone().unwrap_or_default();
    let xor = generate_xor(&prompt, previous);
    drop(chain);

    // Add to chain
    state.xor_chain.lock().unwrap().push(xor.clone());

    // Increment graph nodes
    *state.graph_nodes.lock().unwrap() += 1;

    // Determine route (simplified - would use ML in real impl)
    let route = if prompt.len() > 100 || prompt.contains("redesign") || prompt.contains("analyze") {
        "claude"
    } else {
        "tiny"
    };

    println!("[GENTLYOS] Processed: {} -> XOR: {} via {}",
             interaction.action, xor, route);

    ProcessResult {
        response: format!("Processed '{}' via {} model",
                         interaction.action, route),
        xor,
        route: route.to_string(),
    }
}

#[tauri::command]
fn parse_codie(codie: String) -> String {
    // Simple CODIE parser
    // Format: PRIMITIVE{key:value,key:value}

    let re = regex::Regex::new(r"(\w+)\{([^}]*)\}").ok();

    if let Some(regex) = re {
        if let Some(caps) = regex.captures(&codie) {
            let primitive = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let props = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            return format!(
                r#"<gentlyos-{} data-props="{}">{}</gentlyos-{}>"#,
                primitive.to_lowercase(),
                props,
                primitive,
                primitive.to_lowercase()
            );
        }
    }

    format!("<div>{}</div>", codie)
}

#[tauri::command]
fn hydrate_codie(codie: String) -> String {
    // Hydrate CODIE to HTML
    let parsed = parse_codie(codie);

    format!(
        r#"<div style="padding: 1rem; background: #1a1a2e; border-radius: 0.5rem; color: #e2e8f0;">
            {}
        </div>"#,
        parsed
    )
}

#[tauri::command]
fn get_xor_chain(state: State<AppState>) -> Vec<String> {
    state.xor_chain.lock().unwrap().clone()
}

#[tauri::command]
fn hash(content: String) -> String {
    hash_content(&content)
}

fn main() {
    // System tray
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let show = CustomMenuItem::new("show".to_string(), "Show Window");
    let status = CustomMenuItem::new("status".to_string(), "Status: Active").disabled();

    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(status)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                let window = app.get_window("main").unwrap();
                window.show().unwrap();
                window.set_focus().unwrap();
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "quit" => {
                    std::process::exit(0);
                }
                "show" => {
                    let window = app.get_window("main").unwrap();
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
                _ => {}
            },
            _ => {}
        })
        .manage(AppState {
            xor_chain: Mutex::new(Vec::new()),
            graph_nodes: Mutex::new(0),
            boot_xor: Mutex::new(String::new()),
            initialized: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            initialize,
            get_status,
            process_interaction,
            parse_codie,
            hydrate_codie,
            get_xor_chain,
            hash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
