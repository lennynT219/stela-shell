use std::ffi::{c_void, OsString};
use std::io;
use std::mem::{size_of, size_of_val, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::Console::*;
use windows_sys::Win32::System::JobObjects::*;
use windows_sys::Win32::System::SystemServices::JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO;
use windows_sys::Win32::System::Threading::*;
use windows_sys::Win32::System::IO::*;

struct Handle(HANDLE);
impl Handle {
    fn new(raw: HANDLE, operation: &str) -> Result<Self, String> {
        if raw.is_null() || raw == INVALID_HANDLE_VALUE {
            Err(last_error(operation))
        } else {
            Ok(Self(raw))
        }
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

// The backing storage and all referenced handles outlive CreateProcessW.
struct Attributes {
    _storage: Vec<usize>,
    list: LPPROC_THREAD_ATTRIBUTE_LIST,
}
impl Attributes {
    unsafe fn new() -> Result<Self, String> {
        let mut bytes = 0;
        InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut bytes);
        if bytes == 0 {
            return Err(last_error("size process attributes"));
        }
        let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        let list = storage.as_mut_ptr().cast();
        check(
            InitializeProcThreadAttributeList(list, 2, 0, &mut bytes),
            "initialize process attributes",
        )?;
        Ok(Self {
            _storage: storage,
            list,
        })
    }
    unsafe fn set(&self, attribute: u32, value: *const c_void, bytes: usize) -> Result<(), String> {
        check(
            UpdateProcThreadAttribute(
                self.list,
                0,
                attribute as usize,
                value,
                bytes,
                null_mut(),
                null(),
            ),
            "set process attributes",
        )
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.list);
        }
    }
}

fn last_error(operation: &str) -> String {
    // Never include argv, assignments, environment values, or credentials.
    format!("{operation}: {}", io::Error::last_os_error())
}
fn check(value: i32, operation: &str) -> Result<(), String> {
    if value == 0 {
        Err(last_error(operation))
    } else {
        Ok(())
    }
}
unsafe fn std_handle(which: STD_HANDLE) -> Result<Handle, String> {
    let source = GetStdHandle(which);
    if source.is_null() || source == INVALID_HANDLE_VALUE {
        return Err(last_error("get pipe handle"));
    }
    let current = GetCurrentProcess();
    let mut duplicate = null_mut();
    check(
        DuplicateHandle(
            current,
            source,
            current,
            &mut duplicate,
            0,
            1,
            DUPLICATE_SAME_ACCESS,
        ),
        "duplicate pipe handle",
    )?;
    Handle::new(duplicate, "duplicate pipe handle")
}
unsafe fn information<T>(job: HANDLE, class: JOBOBJECTINFOCLASS, data: &T) -> Result<(), String> {
    check(
        SetInformationJobObject(job, class, (data as *const T).cast(), size_of::<T>() as u32),
        "configure Job Object",
    )
}

unsafe fn empty_job(port: HANDLE) -> Result<(), String> {
    let until = Instant::now() + Duration::from_secs(10);
    loop {
        let remaining = until.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Job Object cleanup did not complete within 10 seconds".into());
        }
        let mut message = 0;
        let mut key = 0;
        let mut overlapped = null_mut();
        check(
            GetQueuedCompletionStatus(
                port,
                &mut message,
                &mut key,
                &mut overlapped,
                remaining.as_millis().min(u32::MAX as u128) as u32,
            ),
            "wait for empty Job Object",
        )?;
        if key == 1 && message == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO {
            return Ok(());
        }
    }
}

pub fn run() -> Result<u32, String> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--parent-pid")) {
        return Err("expected --parent-pid <pid> -- <absolute executable> [args]".into());
    }
    let parent_pid: u32 = args
        .next()
        .and_then(|arg| arg.into_string().ok())
        .and_then(|arg| arg.parse().ok())
        .filter(|pid| *pid > 0)
        .ok_or("invalid parent PID")?;
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--")) {
        return Err("missing executable separator".into());
    }
    let command: OsString = args.next().ok_or("missing child executable")?;
    if !Path::new(&command).is_absolute()
        || Path::new(&command)
            .extension()
            .is_none_or(|ext| !ext.eq_ignore_ascii_case("exe"))
    {
        return Err(
            "child executable must be an absolute .exe path; shell launchers are unsupported"
                .into(),
        );
    }
    let mut argv: Vec<Vec<u16>> = vec![command.encode_wide().collect()];
    argv.extend(args.map(|arg| arg.encode_wide().collect()));
    let mut line = crate::quote::command_line(&argv)?;
    let mut application = argv[0].clone();
    application.push(0);

    unsafe {
        // Opening the parent first lets us detect its death even during startup.
        let parent = Handle::new(
            OpenProcess(PROCESS_SYNCHRONIZE, 0, parent_pid),
            "open parent process",
        )?;
        if WaitForSingleObject(parent.0, 0) != WAIT_TIMEOUT {
            return Err("parent is no longer running".into());
        }
        let port = Handle::new(
            CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1),
            "create completion port",
        )?;
        let job = Handle::new(CreateJobObjectW(null(), null()), "create Job Object")?;
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        information(job.0, JobObjectExtendedLimitInformation, &limits)?;
        let association = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
            CompletionKey: 1usize as *mut c_void,
            CompletionPort: port.0,
        };
        information(
            job.0,
            JobObjectAssociateCompletionPortInformation,
            &association,
        )?;

        let input = std_handle(STD_INPUT_HANDLE)?;
        let output = std_handle(STD_OUTPUT_HANDLE)?;
        let error = std_handle(STD_ERROR_HANDLE)?;
        let inherited = [input.0, output.0, error.0];
        let jobs = [job.0];
        let attributes = Attributes::new()?;
        attributes.set(
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            inherited.as_ptr().cast(),
            size_of_val(&inherited),
        )?;
        // Atomic association at creation closes the crash window between spawning
        // and AssignProcessToJobObject. Never fall back to an uncontained launch.
        // Only stdio is inheritable: neither the Job nor the parent handle leaks.
        attributes.set(
            PROC_THREAD_ATTRIBUTE_JOB_LIST,
            jobs.as_ptr().cast(),
            size_of_val(&jobs),
        )?;
        let mut startup: STARTUPINFOEXW = zeroed();
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = input.0;
        startup.StartupInfo.hStdOutput = output.0;
        startup.StartupInfo.hStdError = error.0;
        startup.lpAttributeList = attributes.list;
        let mut process: PROCESS_INFORMATION = zeroed();
        check(
            CreateProcessW(
                application.as_ptr(),
                line.as_mut_ptr(),
                null(),
                null(),
                1,
                CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
                null(),
                null(),
                &startup.StartupInfo,
                &mut process,
            ),
            "create suspended child in Job Object",
        )?;
        let process_handle = Handle::new(process.hProcess, "child process handle")?;
        let thread = Handle::new(process.hThread, "child thread handle")?;
        let mut contained = 0;
        check(
            IsProcessInJob(process_handle.0, job.0, &mut contained),
            "verify Job Object association",
        )?;
        if contained == 0 {
            // Atomic assignment should make this impossible; fail closed anyway.
            TerminateProcess(process_handle.0, 125);
            return Err("child is not contained in the Job Object".into());
        }
        if WaitForSingleObject(parent.0, 0) != WAIT_TIMEOUT {
            return Err("parent exited before child resume".into());
        }
        if ResumeThread(thread.0) == u32::MAX {
            return Err(last_error("resume child"));
        }
        drop(thread);
        drop(attributes);
        drop((input, output, error));

        // No model calls or process polling. A parent crash triggers Job cleanup;
        // terminating this helper also closes its only Job handle in the kernel.
        let handles = [parent.0, process_handle.0];
        let completed = WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, INFINITE);
        if completed != WAIT_OBJECT_0 && completed != WAIT_OBJECT_0 + 1 {
            return Err(last_error("wait for parent or child"));
        }
        let mut exit_code = 125;
        if completed == WAIT_OBJECT_0 + 1 {
            check(
                GetExitCodeProcess(process_handle.0, &mut exit_code),
                "read child exit code",
            )?;
        }
        // Even a successful leader must not leave background descendants behind.
        check(
            TerminateJobObject(job.0, 125),
            "terminate remaining Job processes",
        )?;
        empty_job(port.0)?;
        Ok(exit_code)
    }
}
