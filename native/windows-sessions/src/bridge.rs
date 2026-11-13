use crate::framing::{self, fields, number, output, text, Result};
use crate::pipes::{self, Replies};
use crate::security::process_sid;
use crate::state::Store;
use std::collections::HashMap;
use std::io;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use windows_sys::Win32::System::Threading::{WaitForSingleObject, INFINITE};

pub fn run() -> Result<()> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("--parent-pid") {
        return Err("Missing owner".into());
    }
    let pid: u32 = args
        .next()
        .and_then(|s| s.parse().ok())
        .filter(|n| *n > 0)
        .ok_or("Invalid owner")?;
    if args.next().is_some() || pid == std::process::id() {
        return Err("Invalid arguments".into());
    }
    let (parent, sid) = process_sid(pid)?;
    let (_own, own_sid) = process_sid(std::process::id())?;
    if sid != own_sid {
        return Err("Owner identity mismatch".into());
    }
    std::thread::spawn(move || {
        unsafe {
            WaitForSingleObject(parent.raw(), INFINITE);
        }
        std::process::exit(0);
    });
    let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
    let outbound = Arc::new(AtomicUsize::new(0));
    let mut store: Option<Store> = None;
    let mut input = io::stdin().lock();
    while let Some(bytes) = framing::read(&mut input)? {
        let op = bytes[0];
        let request = number(&bytes[1..5])?;
        if request == 0 {
            return Err("Invalid request ID".into());
        }
        let args = fields(&bytes[5..])?;
        if op == 6 {
            if args.len() != 1 || args[0].len() > framing::MAX_WIRE {
                return Err("Invalid admission response".into());
            }
            if let Some(sender) = replies
                .lock()
                .map_err(|_| "Reply lock failed")?
                .get(&request)
            {
                let _ = sender.try_send(args[0].to_vec());
            }
            continue;
        }
        let result: Result<Vec<Vec<u8>>> = (|| {
            match op {
                1 if store.is_none() && args.len() == 3 && number(args[0])? == 1 => {
                    let opened =
                        Store::open(text(args[1])?, framing::id(args[2])?, own_sid.clone())?;
                    pipes::listen(&opened.namespace, &opened.id, &opened.sid, replies.clone())?;
                    let answer = vec![
                        1u32.to_le_bytes().to_vec(),
                        opened.profile.as_bytes().to_vec(),
                        std::process::id().to_le_bytes().to_vec(),
                        opened.namespace.as_bytes().to_vec(),
                    ];
                    store = Some(opened);
                    Ok(answer)
                }
                2 if args.len() == 1 => {
                    store.as_mut().ok_or("Not initialized")?.publish(args[0])?;
                    Ok(vec![])
                }
                3 if args.len() == 1 => Ok(vec![store
                    .as_ref()
                    .ok_or("Not initialized")?
                    .read(framing::id(args[0])?)?]),
                4 if args.is_empty() => Ok(store
                    .as_ref()
                    .ok_or("Not initialized")?
                    .ids()?
                    .into_iter()
                    .map(String::into_bytes)
                    .collect()),
                5 if args.len() == 3 => {
                    let store = store.as_ref().ok_or("Not initialized")?;
                    let target = framing::id(args[0])?.to_string();
                    let pid = number(args[1])?;
                    let bytes = args[2].to_vec();
                    if bytes.len() > framing::MAX_WIRE {
                        return Err("Wire frame limit".into());
                    }
                    #[allow(deprecated)] // fetch_update preserves the declared Rust 1.85 minimum.
                    let admitted = outbound.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                        (n < 4).then_some(n + 1)
                    });
                    if admitted.is_err() {
                        return Err("Outbound connection limit".into());
                    }
                    let namespace = store.namespace.clone();
                    let sid = own_sid.clone();
                    let count = outbound.clone();
                    std::thread::spawn(move || {
                        let response = pipes::request(&namespace, &target, pid, &sid, &bytes);
                        let _ = match response { Ok(bytes) => output(0,request,&[&bytes]), Err(_) => output(127,request,&[b"Native request failed; delivery unconfirmed. Do not automatically retry."]) };
                        count.fetch_sub(1, Ordering::SeqCst);
                    });
                    return Ok(vec![]);
                }
                7 if args.is_empty() => {
                    drop(store.take());
                    Ok(vec![])
                }
                _ => Err("Invalid bridge operation/state".into()),
            }
        })();
        if op == 5 && result.is_ok() {
            continue;
        }
        match result {
            Ok(result) => {
                let borrowed: Vec<&[u8]> = result.iter().map(Vec::as_slice).collect();
                output(0, request, &borrowed)?;
            }
            Err(error) => {
                output(127, request, &[error.as_bytes()])?;
                if op == 1 {
                    return Err(error);
                }
            }
        }
        if op == 7 {
            break;
        }
    }
    drop(store);
    Ok(())
}
