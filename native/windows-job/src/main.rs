mod quote;

#[cfg(windows)]
mod windows;

#[cfg(windows)]
fn main() {
    match windows::run() {
        Ok(code) => std::process::exit(code as i32),
        Err(error) => {
            eprintln!("stela-job: {error}");
            std::process::exit(125);
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("stela-job is a Windows-only process controller; POSIX uses process groups.");
    std::process::exit(125);
}
