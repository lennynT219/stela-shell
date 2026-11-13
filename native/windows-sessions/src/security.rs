use crate::framing::Result;
use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::null_mut;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::Authorization::*;
use windows_sys::Win32::Security::*;
use windows_sys::Win32::Storage::FileSystem::*;
use windows_sys::Win32::System::Threading::*;

pub struct Handle(pub HANDLE);
unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}
impl Handle {
    pub fn raw(&self) -> HANDLE {
        self.0
    }
    pub fn new(raw: HANDLE) -> Result<Self> {
        if raw.is_null() || raw == INVALID_HANDLE_VALUE {
            Err("Native handle operation failed".into())
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
pub struct Local(pub *mut c_void);
impl Drop for Local {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}
pub fn wide(s: &str) -> Result<Vec<u16>> {
    if s.contains('\0') || s.encode_utf16().count() > 32760 {
        return Err("Invalid native string".into());
    }
    Ok(s.encode_utf16().chain(Some(0)).collect())
}
pub fn check(ok: i32) -> Result<()> {
    if ok == 0 {
        Err("Windows operation failed".into())
    } else {
        Ok(())
    }
}
pub fn token_sid(token: HANDLE) -> Result<String> {
    unsafe {
        let mut n = 0;
        GetTokenInformation(token, TokenUser, null_mut(), 0, &mut n);
        if n == 0 || n > 65536 {
            return Err("Invalid token size".into());
        }
        let mut data = vec![0usize; (n as usize).div_ceil(size_of::<usize>())];
        check(GetTokenInformation(
            token,
            TokenUser,
            data.as_mut_ptr().cast(),
            n,
            &mut n,
        ))?;
        sid_string((*(data.as_ptr().cast::<TOKEN_USER>())).User.Sid)
    }
}
pub unsafe fn sid_string(sid: PSID) -> Result<String> {
    if IsValidSid(sid) == 0 {
        return Err("Invalid SID".into());
    }
    let mut ptr = null_mut();
    check(ConvertSidToStringSidW(sid, &mut ptr))?;
    let _allocation = Local(ptr.cast());
    let mut n = 0;
    while n < 256 && *ptr.add(n) != 0 {
        n += 1;
    }
    if n == 256 {
        return Err("Invalid SID length".into());
    }
    String::from_utf16(std::slice::from_raw_parts(ptr, n)).map_err(|_| "Invalid SID".into())
}
pub fn process_sid(pid: u32) -> Result<(Handle, String)> {
    unsafe {
        let process = Handle::new(OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
            0,
            pid,
        ))?;
        let mut token = null_mut();
        check(OpenProcessToken(process.0, TOKEN_QUERY, &mut token))?;
        let token = Handle::new(token)?;
        if WaitForSingleObject(process.0, 0) != WAIT_TIMEOUT {
            return Err("Peer process exited".into());
        }
        let sid = token_sid(token.0)?;
        Ok((process, sid))
    }
}
pub struct Descriptor(Local);
unsafe impl Send for Descriptor {}
unsafe impl Sync for Descriptor {}
impl Descriptor {
    pub fn new(sid: &str) -> Result<Self> {
        let sddl = wide(&format!("O:{sid}D:P(A;;FA;;;{sid})(A;;FA;;;SY)"))?;
        unsafe {
            let mut sd = null_mut();
            check(ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut sd,
                null_mut(),
            ))?;
            Ok(Self(Local(sd)))
        }
    }
    pub fn ptr(&self) -> PSECURITY_DESCRIPTOR {
        self.0 .0
    }
    pub fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.ptr(),
            bInheritHandle: 0,
        }
    }
}
fn trusted(sid: &str, own: &str) -> bool {
    sid == own
        || sid == "S-1-5-18"
        || sid == "S-1-5-32-544"
        || sid == "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"
    // TrustedInstaller
}
/// Inspect the descriptor returned for the *opened handle*, never a separate path query.
pub fn validate(handle: HANDLE, own: &str, private: bool) -> Result<()> {
    unsafe {
        let mut owner = null_mut();
        let mut acl = null_mut();
        let mut sd = null_mut();
        if GetSecurityInfo(
            handle,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut acl,
            null_mut(),
            &mut sd,
        ) != 0
        {
            return Err("Cannot inspect native security".into());
        }
        let _allocation = Local(sd);
        let owner = sid_string(owner)?;
        if !trusted(&owner, own) || (private && owner != own) || acl.is_null() {
            return Err("Unsafe state owner/DACL".into());
        }
        let mut control = 0;
        let mut revision = 0;
        check(GetSecurityDescriptorControl(
            sd,
            &mut control,
            &mut revision,
        ))?;
        if private && control & SE_DACL_PROTECTED == 0 {
            return Err("Session state DACL must be protected".into());
        }
        if !IsValidAcl(acl).eq(&1) {
            return Err("Invalid DACL".into());
        }
        for index in 0..(*acl).AceCount as u32 {
            let mut raw = null_mut();
            check(GetAce(acl, index, &mut raw))?;
            let header = &*(raw.cast::<ACE_HEADER>());
            if header.AceFlags & INHERIT_ONLY_ACE as u8 != 0 || header.AceType == 1 {
                continue;
            } // deny ACEs grant nothing
            if header.AceType != 0 || (header.AceSize as usize) < size_of::<ACCESS_ALLOWED_ACE>() {
                return Err("Unsupported DACL ACE".into());
            }
            let ace = &*(raw.cast::<ACCESS_ALLOWED_ACE>());
            let sid = sid_string((&ace.SidStart as *const u32).cast_mut().cast())?;
            // Ancestors may permit creation/read, but not namespace replacement, ACL takeover or reparse mutation.
            let unsafe_rights = DELETE
                | WRITE_DAC
                | WRITE_OWNER
                | FILE_DELETE_CHILD
                | FILE_WRITE_ATTRIBUTES
                | GENERIC_ALL
                | GENERIC_WRITE;
            if !trusted(&sid, own) && (private || ace.Mask & unsafe_rights != 0) {
                return Err("Unsafe state DACL grant".into());
            }
        }
    }
    Ok(())
}
