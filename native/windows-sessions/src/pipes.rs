use crate::framing::{id, output, Result, MAX_WIRE};
use crate::security::{check, process_sid, token_sid, wide, Descriptor, Handle};
use std::collections::HashMap;
use std::mem::zeroed;
use std::ptr::{null, null_mut};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    mpsc::{self, SyncSender},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::*;
use windows_sys::Win32::Storage::FileSystem::*;
use windows_sys::Win32::System::Pipes::*;
use windows_sys::Win32::System::Threading::*;
use windows_sys::Win32::System::IO::*;

pub type Replies = Arc<Mutex<HashMap<u32, SyncSender<Vec<u8>>>>>;
pub fn endpoint(namespace: &str, activation: &str) -> Result<Vec<u16>> {
    id(namespace.as_bytes())?;
    id(activation.as_bytes())?;
    wide(&format!("\\\\.\\pipe\\stela-{namespace}-{activation}"))
}
fn remaining(until: Instant) -> Result<u32> {
    let left = until.saturating_duration_since(Instant::now());
    if left.is_zero() {
        Err("Pipe deadline exceeded".into())
    } else {
        Ok(left.as_millis().clamp(1, u32::MAX as u128) as u32)
    }
}
/// Cancel AND drain pending I/O before releasing OVERLAPPED/event/buffer storage.
fn operation(
    pipe: HANDLE,
    until: Option<Instant>,
    start: impl FnOnce(*mut OVERLAPPED, *mut u32) -> i32,
) -> Result<u32> {
    unsafe {
        let event = Handle::new(CreateEventW(null(), 1, 0, null()))?;
        let mut overlap: OVERLAPPED = zeroed();
        overlap.hEvent = event.0;
        let mut n = 0;
        if start(&mut overlap, &mut n) != 0 {
            return Ok(n);
        }
        let error = GetLastError();
        if error == ERROR_PIPE_CONNECTED {
            return Ok(0);
        }
        if error != ERROR_IO_PENDING {
            return Err("Pipe operation failed".into());
        }
        let wait = until.map(remaining).transpose();
        let completed = match wait {
            Ok(ms) => WaitForSingleObject(event.0, ms.unwrap_or(INFINITE)) == WAIT_OBJECT_0,
            Err(_) => false,
        };
        if !completed {
            CancelIoEx(pipe, &overlap);
            GetOverlappedResult(pipe, &overlap, &mut n, 1);
            return Err("Pipe deadline exceeded".into());
        }
        check(GetOverlappedResult(pipe, &overlap, &mut n, 0))?;
        Ok(n)
    }
}
fn read(pipe: HANDLE, until: Instant) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    loop {
        remaining(until)?;
        let mut chunk = [0u8; 4096];
        let n = operation(pipe, Some(until), |overlap, n| unsafe {
            ReadFile(pipe, chunk.as_mut_ptr(), chunk.len() as u32, n, overlap)
        })? as usize;
        if n == 0 || bytes.len() + n > MAX_WIRE {
            return Err("Pipe frame limit/disconnect".into());
        }
        bytes.extend(&chunk[..n]);
        if let Some(index) = bytes.iter().position(|b| *b == 10) {
            if index != bytes.len() - 1 {
                return Err("Pipe frame trailing bytes".into());
            }
            return Ok(bytes);
        }
    }
}
fn write(pipe: HANDLE, bytes: &[u8], until: Instant) -> Result<()> {
    if bytes.is_empty() || bytes.len() > MAX_WIRE || bytes.last() != Some(&10) {
        return Err("Invalid pipe frame size".into());
    }
    let mut offset = 0;
    while offset < bytes.len() {
        remaining(until)?;
        let n = operation(pipe, Some(until), |overlap, n| unsafe {
            WriteFile(
                pipe,
                bytes[offset..].as_ptr(),
                (bytes.len() - offset) as u32,
                n,
                overlap,
            )
        })? as usize;
        if n == 0 {
            return Err("Pipe disconnected".into());
        }
        offset += n;
    }
    Ok(())
}
fn client_identity(pipe: HANDLE, own_sid: &str) -> Result<u32> {
    unsafe {
        let mut pid = 0;
        check(GetNamedPipeClientProcessId(pipe, &mut pid))?;
        check(ImpersonateNamedPipeClient(pipe))?;
        // No asynchronous work or thread handoff while impersonating.
        let outcome: Result<()> = (|| {
            let mut token = null_mut();
            check(OpenThreadToken(
                GetCurrentThread(),
                TOKEN_QUERY,
                1,
                &mut token,
            ))?;
            let token = Handle::new(token)?;
            if token_sid(token.0)? != own_sid {
                return Err("Foreign pipe client SID".into());
            }
            Ok(())
        })();
        if RevertToSelf() == 0 {
            std::process::exit(125);
        }
        outcome?;
        let (_process, sid) = process_sid(pid)?;
        if sid != own_sid {
            return Err("Foreign pipe process SID".into());
        }
        Ok(pid)
    }
}
pub fn listen(namespace: &str, activation: &str, sid: &str, replies: Replies) -> Result<()> {
    let name = endpoint(namespace, activation)?;
    let descriptor = Descriptor::new(sid)?;
    let attrs = descriptor.attributes();
    let mut handles = Vec::new();
    for index in 0..8 {
        handles.push(Handle::new(unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_DUPLEX
                    | FILE_FLAG_OVERLAPPED
                    | if index == 0 {
                        FILE_FLAG_FIRST_PIPE_INSTANCE
                    } else {
                        0
                    },
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                8,
                MAX_WIRE as u32,
                MAX_WIRE as u32,
                2000,
                &attrs,
            )
        })?);
    }
    let next = Arc::new(AtomicU32::new(0));
    for pipe in handles {
        let replies = replies.clone();
        let sid = sid.to_string();
        let next = next.clone();
        std::thread::spawn(move || loop {
            let connected = operation(pipe.raw(), None, |overlap, _| unsafe {
                ConnectNamedPipe(pipe.raw(), overlap)
            });
            if connected.is_err() {
                break;
            }
            let until = Instant::now() + Duration::from_secs(2);
            let _ = (|| -> Result<()> {
                let bytes = read(pipe.raw(), until)?;
                // Impersonation uses the security context of the last message read.
                let pid = client_identity(pipe.raw(), &sid)?;
                let connection = next
                    .fetch_add(1, Ordering::SeqCst)
                    .checked_add(1)
                    .ok_or("Connection IDs exhausted")?;
                let (tx, rx) = mpsc::sync_channel(1);
                replies
                    .lock()
                    .map_err(|_| "Reply lock failed")?
                    .insert(connection, tx);
                let result = (|| {
                    output(64, connection, &[&pid.to_le_bytes(), &bytes])?;
                    let answer = rx
                        .recv_timeout(Duration::from_millis(remaining(until)? as u64))
                        .map_err(|_| "Admission deadline")?;
                    write(pipe.raw(), &answer, until)?;
                    // Keep the server end alive until the client consumes its ACK and closes.
                    // Never use blocking FlushFileBuffers against an untrusted/nonreading client.
                    let mut byte = 0;
                    let _ = operation(pipe.raw(), Some(until), |overlap, n| unsafe {
                        ReadFile(pipe.raw(), &mut byte, 1, n, overlap)
                    });
                    Ok(())
                })();
                replies
                    .lock()
                    .map_err(|_| "Reply lock failed")?
                    .remove(&connection);
                result
            })();
            unsafe {
                DisconnectNamedPipe(pipe.raw());
            }
        });
    }
    Ok(())
}
pub fn request(
    namespace: &str,
    activation: &str,
    expected_pid: u32,
    sid: &str,
    bytes: &[u8],
) -> Result<Vec<u8>> {
    let until = Instant::now() + Duration::from_secs(2);
    let name = endpoint(namespace, activation)?;
    let pipe = Handle::new(unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
            null_mut(),
        )
    })?;
    unsafe {
        let mut actual = 0;
        check(GetNamedPipeServerProcessId(pipe.raw(), &mut actual))?;
        let (_process, actual_sid) = process_sid(actual)?;
        if actual != expected_pid || actual_sid != sid {
            return Err("Pipe server identity mismatch".into());
        }
    }
    write(pipe.raw(), bytes, until)?;
    read(pipe.raw(), until)
}
