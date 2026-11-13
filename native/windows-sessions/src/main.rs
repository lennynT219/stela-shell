#[cfg(windows)]
mod bridge;
mod framing;
#[cfg(windows)]
mod pipes;
#[cfg(windows)]
mod security;
#[cfg(windows)]
mod state;
fn main() {
    #[cfg(windows)]
    if bridge::run().is_err() {
        // Never echo a frame, profile, capability, message or command argument.
        eprintln!("stela-sessions: native bridge failed");
        std::process::exit(125);
    }
    #[cfg(not(windows))]
    {
        eprintln!("stela-sessions is Windows-only");
        std::process::exit(125);
    }
}
