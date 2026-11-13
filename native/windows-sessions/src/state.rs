use crate::framing::{id, Result};
use crate::security::{check, validate, wide, Descriptor, Handle};
use std::mem::{offset_of, size_of, zeroed};
use std::path::{Component, Path, Prefix};
use std::ptr::{null, null_mut};
use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    NtCreateFile, FILE_CREATE, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
    FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT,
};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::Cryptography::*;
use windows_sys::Win32::Storage::FileSystem::*;
use windows_sys::Win32::System::SystemServices::FILE_PERSISTENT_ACLS;
use windows_sys::Win32::System::IO::{IO_STATUS_BLOCK, OVERLAPPED};

pub struct Store {
    _ancestors: Vec<Handle>,
    root: Handle,
    own: Option<Handle>,
    pub profile: String,
    pub namespace: String,
    pub sid: String,
    pub id: String,
    descriptor: Descriptor,
}
fn info(handle: HANDLE, directory: bool) -> Result<BY_HANDLE_FILE_INFORMATION> {
    unsafe {
        let mut data: BY_HANDLE_FILE_INFORMATION = zeroed();
        check(GetFileInformationByHandle(handle, &mut data))?;
        if data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
            || (!directory
                && (data.nNumberOfLinks != 1
                    || data.nFileSizeHigh != 0
                    || data.nFileSizeLow > 4096))
        {
            return Err("Unsafe state file type/size/link".into());
        }
        Ok(data)
    }
}
fn relative(
    parent: HANDLE,
    name: &str,
    directory: bool,
    disposition: u32,
    descriptor: Option<&Descriptor>,
    writing: bool,
) -> Result<Handle> {
    if name.is_empty()
        || name.contains(['\\', '/', ':', '\0'])
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
    {
        return Err("Invalid state component".into());
    }
    let mut name = wide(name)?;
    unsafe {
        let unicode = UNICODE_STRING {
            Length: ((name.len() - 1) * 2) as u16,
            MaximumLength: (name.len() * 2) as u16,
            Buffer: name.as_mut_ptr(),
        };
        let attrs = OBJECT_ATTRIBUTES {
            Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: parent,
            ObjectName: &unicode,
            Attributes: OBJ_CASE_INSENSITIVE,
            SecurityDescriptor: descriptor.map_or(null(), |d| d.ptr().cast()),
            SecurityQualityOfService: null(),
        };
        let mut handle = null_mut();
        let mut status: IO_STATUS_BLOCK = zeroed();
        let access = READ_CONTROL
            | SYNCHRONIZE
            | FILE_READ_ATTRIBUTES
            | if directory {
                FILE_LIST_DIRECTORY | FILE_TRAVERSE
            } else {
                FILE_READ_DATA
            }
            | if writing { FILE_WRITE_DATA | DELETE } else { 0 };
        let result = NtCreateFile(
            &mut handle,
            access,
            &attrs,
            &mut status,
            null(),
            FILE_ATTRIBUTE_NORMAL,
            FILE_SHARE_READ | FILE_SHARE_WRITE | if directory { 0 } else { FILE_SHARE_DELETE },
            disposition,
            FILE_OPEN_REPARSE_POINT
                | FILE_SYNCHRONOUS_IO_NONALERT
                | if directory {
                    FILE_DIRECTORY_FILE
                } else {
                    FILE_NON_DIRECTORY_FILE
                },
            null(),
            0,
        );
        if result < 0 {
            return Err(format!("State handle open failed ({:08x})", result as u32));
        }
        Handle::new(handle)
    }
}
fn digest(input: &[u8]) -> Result<String> {
    unsafe {
        let mut algorithm = null_mut();
        let name = wide("SHA256")?;
        if BCryptOpenAlgorithmProvider(&mut algorithm, name.as_ptr(), null(), 0) < 0 {
            return Err("Namespace hash failed".into());
        }
        let mut bytes = [0; 32];
        let status = BCryptHash(
            algorithm,
            null(),
            0,
            input.as_ptr(),
            input.len() as u32,
            bytes.as_mut_ptr(),
            32,
        );
        BCryptCloseAlgorithmProvider(algorithm, 0);
        if status < 0 {
            return Err("Namespace hash failed".into());
        }
        Ok(bytes[..16].iter().map(|b| format!("{b:02x}")).collect())
    }
}
impl Store {
    pub fn open(profile: &str, activation: &str, sid: String) -> Result<Self> {
        id(activation.as_bytes())?;
        let path = Path::new(profile);
        let mut components = path.components();
        let drive = match components.next() {
            Some(Component::Prefix(p)) => match p.kind() {
                Prefix::Disk(d) | Prefix::VerbatimDisk(d) => d,
                _ => return Err("Only local drive profiles are supported".into()),
            },
            _ => return Err("Profile must be an absolute local path".into()),
        };
        if components.next() != Some(Component::RootDir) {
            return Err("Profile must be absolute".into());
        }
        let volume = wide(&format!("{}:\\", drive as char))?;
        let mut ancestors = Vec::new();
        unsafe {
            if GetDriveTypeW(volume.as_ptr()) != 3 {
                return Err("Profile must be on a fixed local volume".into());
            }
            let root = Handle::new(CreateFileW(
                volume.as_ptr(),
                READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_TRAVERSE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            ))?;
            info(root.0, true)?;
            validate(root.0, &sid, false)?;
            ancestors.push(root);
        }
        for component in components {
            let name = match component {
                Component::Normal(n) => n.to_str().ok_or("Invalid profile encoding")?,
                _ => return Err("Unsafe profile component".into()),
            };
            let opened = relative(
                ancestors.last().unwrap().0,
                name,
                true,
                FILE_OPEN,
                None,
                false,
            )?;
            info(opened.0, true)?;
            validate(opened.0, &sid, false)?;
            ancestors.push(opened);
        }
        if ancestors.len() < 2 {
            return Err("A volume root is not a session profile".into());
        }
        let profile_handle = ancestors.last().unwrap().0;
        let mut identity: FILE_ID_INFO = unsafe { zeroed() };
        let mut final_path = vec![0u16; 32768];
        unsafe {
            let mut flags = 0;
            check(GetVolumeInformationByHandleW(
                profile_handle,
                null_mut(),
                0,
                null_mut(),
                null_mut(),
                &mut flags,
                null_mut(),
                0,
            ))?;
            if flags & FILE_PERSISTENT_ACLS == 0 {
                return Err("Profile filesystem has no persistent ACLs".into());
            }
            check(GetFileInformationByHandleEx(
                profile_handle,
                FileIdInfo,
                (&mut identity as *mut FILE_ID_INFO).cast(),
                size_of::<FILE_ID_INFO>() as u32,
            ))?;
            let n = GetFinalPathNameByHandleW(
                profile_handle,
                final_path.as_mut_ptr(),
                final_path.len() as u32,
                0,
            ) as usize;
            if n == 0 || n >= final_path.len() {
                return Err("Canonical profile lookup failed".into());
            }
            final_path.truncate(n);
        }
        let mut key = sid.as_bytes().to_vec();
        key.extend(identity.VolumeSerialNumber.to_le_bytes());
        key.extend(identity.FileId.Identifier);
        let namespace = digest(&key)?;
        let descriptor = Descriptor::new(&sid)?;
        let root = relative(
            profile_handle,
            "stela-sessions",
            true,
            FILE_OPEN_IF,
            Some(&descriptor),
            false,
        )?;
        info(root.0, true)?;
        validate(root.0, &sid, true)?;
        let canonical = String::from_utf16(&final_path).map_err(|_| "Invalid canonical profile")?;
        Ok(Self {
            _ancestors: ancestors,
            root,
            own: None,
            profile: canonical
                .strip_prefix("\\\\?\\")
                .unwrap_or(&canonical)
                .to_string(),
            namespace,
            sid,
            id: activation.into(),
            descriptor,
        })
    }
    pub fn publish(&mut self, bytes: &[u8]) -> Result<()> {
        validate(self.root.0, &self.sid, true)?;
        if bytes.is_empty() || bytes.len() > 4096 {
            return Err("Presence size limit".into());
        }
        if self.own.is_none() {
            self.own = Some(relative(
                self.root.0,
                &format!("{}.json", self.id),
                false,
                FILE_CREATE,
                Some(&self.descriptor),
                true,
            )?);
        }
        let file = self.own.as_ref().unwrap();
        info(file.0, false)?;
        validate(file.0, &self.sid, true)?;
        let _lock = Lock::new(file.0, true)?;
        unsafe {
            check(SetFilePointerEx(file.0, 0, null_mut(), FILE_BEGIN))?;
            let mut written = 0;
            check(WriteFile(
                file.0,
                bytes.as_ptr(),
                bytes.len() as u32,
                &mut written,
                null_mut(),
            ))?;
            if written as usize != bytes.len() {
                return Err("Presence write incomplete".into());
            }
            check(SetEndOfFile(file.0))?;
        }
        Ok(())
    }
    pub fn read(&self, activation: &str) -> Result<Vec<u8>> {
        validate(self.root.0, &self.sid, true)?;
        id(activation.as_bytes())?;
        let file = relative(
            self.root.0,
            &format!("{activation}.json"),
            false,
            FILE_OPEN,
            None,
            false,
        )?;
        info(file.0, false)?;
        validate(file.0, &self.sid, true)?;
        let _lock = Lock::new(file.0, false)?;
        let mut bytes = vec![0; 4097];
        let mut n = 0;
        unsafe {
            check(ReadFile(
                file.0,
                bytes.as_mut_ptr(),
                bytes.len() as u32,
                &mut n,
                null_mut(),
            ))?;
        }
        if n == 0 || n > 4096 {
            return Err("Presence size limit".into());
        }
        bytes.truncate(n as usize);
        Ok(bytes)
    }
    pub fn ids(&self) -> Result<Vec<String>> {
        validate(self.root.0, &self.sid, true)?;
        let mut buffer = vec![0usize; 8192 / size_of::<usize>()];
        let mut result = Vec::new();
        let mut count = 0;
        let mut class = FileIdBothDirectoryRestartInfo;
        loop {
            unsafe {
                if GetFileInformationByHandleEx(
                    self.root.0,
                    class,
                    buffer.as_mut_ptr().cast(),
                    8192,
                ) == 0
                {
                    if GetLastError() == ERROR_NO_MORE_FILES {
                        break;
                    }
                    return Err("State enumeration failed".into());
                }
                class = FileIdBothDirectoryInfo;
                let mut offset = 0usize;
                loop {
                    if offset + size_of::<FILE_ID_BOTH_DIR_INFO>() > 8192 {
                        return Err("Invalid directory result".into());
                    }
                    let raw = buffer
                        .as_ptr()
                        .cast::<u8>()
                        .add(offset)
                        .cast::<FILE_ID_BOTH_DIR_INFO>();
                    let length = (*raw).FileNameLength as usize;
                    if length % 2 != 0
                        || offset + offset_of!(FILE_ID_BOTH_DIR_INFO, FileName) + length > 8192
                    {
                        return Err("Invalid directory name".into());
                    }
                    let name = String::from_utf16(std::slice::from_raw_parts(
                        (*raw).FileName.as_ptr(),
                        length / 2,
                    ))
                    .map_err(|_| "Invalid directory name")?;
                    if name != "." && name != ".." {
                        count += 1;
                        if count > 128 {
                            return Err(
                                "Presence scan limit reached; review stale records manually".into(),
                            );
                        }
                        if let Some(value) = name.strip_suffix(".json") {
                            if id(value.as_bytes()).is_ok() && value != self.id {
                                result.push(value.into());
                            }
                        }
                    }
                    let next = (*raw).NextEntryOffset as usize;
                    if next == 0 {
                        break;
                    }
                    if next < size_of::<FILE_ID_BOTH_DIR_INFO>() || offset + next >= 8192 {
                        return Err("Invalid directory offset".into());
                    }
                    offset += next;
                }
            }
        }
        Ok(result)
    }
}
impl Drop for Store {
    fn drop(&mut self) {
        if let Some(file) = self.own.take() {
            // Delete only the opened original record, never another activation or a path replacement.
            let mut disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
            unsafe {
                SetFileInformationByHandle(
                    file.0,
                    FileDispositionInfo,
                    (&mut disposition as *mut FILE_DISPOSITION_INFO).cast(),
                    size_of::<FILE_DISPOSITION_INFO>() as u32,
                );
            }
        }
    }
}
struct Lock(HANDLE);
impl Lock {
    fn new(file: HANDLE, exclusive: bool) -> Result<Self> {
        let mut overlap: OVERLAPPED = unsafe { zeroed() };
        unsafe {
            check(LockFileEx(
                file,
                LOCKFILE_FAIL_IMMEDIATELY
                    | if exclusive {
                        LOCKFILE_EXCLUSIVE_LOCK
                    } else {
                        0
                    },
                0,
                4097,
                0,
                &mut overlap,
            ))?;
        }
        Ok(Self(file))
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        let mut overlap = unsafe { zeroed() };
        unsafe {
            UnlockFileEx(self.0, 0, 4097, 0, &mut overlap);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::process_sid;
    fn fixture(label: &str) -> (std::path::PathBuf, Store) {
        let path = std::env::temp_dir().join(format!(
            "stela-sessions-rust-{}-{label}",
            std::process::id()
        ));
        std::fs::create_dir(&path).unwrap();
        let (_process, sid) = process_sid(std::process::id()).unwrap();
        let store = Store::open(path.to_str().unwrap(), &"a".repeat(32), sid).unwrap();
        (path, store)
    }
    #[test]
    fn private_handle_state_bounds_and_owner() {
        let (path, mut store) = fixture("bounds");
        store.publish(b"first").unwrap();
        assert!(store.publish(&vec![0; 4097]).is_err());
        assert_eq!(store.read(&store.id).unwrap(), b"first");
        assert!(validate(store.root.0, "S-1-1-0", true).is_err());
        assert!(store.read("../outside").is_err());
        drop(store);
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn cleanup_deletes_opened_original_not_path_replacement() {
        let (path, mut store) = fixture("replacement");
        store.publish(b"original").unwrap();
        let original = path
            .join("stela-sessions")
            .join(format!("{}.json", store.id));
        let moved = path.join("stela-sessions/moved");
        std::fs::rename(&original, &moved).unwrap();
        std::fs::write(&original, b"replacement").unwrap();
        drop(store);
        assert!(!moved.exists());
        assert_eq!(std::fs::read(&original).unwrap(), b"replacement");
        std::fs::remove_dir_all(path).unwrap();
    }
}
