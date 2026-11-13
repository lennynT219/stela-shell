use std::io::{self, Read, Write};
pub const MAX_FRAME: usize = 140 * 1024;
pub const MAX_WIRE: usize = 128 * 1024;
pub type Result<T> = std::result::Result<T, String>;
pub fn fields(bytes: &[u8]) -> Result<Vec<&[u8]>> {
    let mut rest = bytes;
    let mut result = Vec::new();
    while !rest.is_empty() {
        if rest.len() < 4 || result.len() >= 130 {
            return Err("Invalid bridge fields".into());
        }
        let n = u32::from_le_bytes(rest[..4].try_into().unwrap()) as usize;
        rest = &rest[4..];
        if n > rest.len() {
            return Err("Invalid bridge field size".into());
        }
        result.push(&rest[..n]);
        rest = &rest[n..];
    }
    Ok(result)
}
pub fn frame(op: u8, id: u32, fields: &[&[u8]]) -> Result<Vec<u8>> {
    let mut body = vec![op];
    body.extend(id.to_le_bytes());
    for field in fields {
        body.extend((field.len() as u32).to_le_bytes());
        body.extend(*field);
    }
    if body.len() > MAX_FRAME {
        return Err("Bridge frame limit".into());
    }
    let mut out = (body.len() as u32).to_le_bytes().to_vec();
    out.extend(body);
    Ok(out)
}
pub fn read(input: &mut impl Read) -> Result<Option<Vec<u8>>> {
    let mut size = [0u8; 4];
    match input.read(&mut size[..1]) {
        Ok(0) => return Ok(None),
        Ok(_) => {}
        Err(_) => return Err("Bridge read failed".into()),
    }
    input
        .read_exact(&mut size[1..])
        .map_err(|_| "Incomplete bridge header")?;
    let n = u32::from_le_bytes(size) as usize;
    if !(5..=MAX_FRAME).contains(&n) {
        return Err("Bridge frame limit".into());
    }
    let mut bytes = vec![0; n];
    input
        .read_exact(&mut bytes)
        .map_err(|_| "Incomplete bridge frame")?;
    Ok(Some(bytes))
}
pub fn output(op: u8, id: u32, fields: &[&[u8]]) -> Result<()> {
    let bytes = frame(op, id, fields)?;
    let stdout = io::stdout();
    let mut lock = stdout.lock();
    lock.write_all(&bytes)
        .and_then(|_| lock.flush())
        .map_err(|_| "Bridge write failed".into())
}
pub fn text(value: &[u8]) -> Result<&str> {
    std::str::from_utf8(value).map_err(|_| "Invalid UTF-8".into())
}
pub fn id(value: &[u8]) -> Result<&str> {
    let s = text(value)?;
    if s.len() != 32
        || !s
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Invalid activation ID".into());
    }
    Ok(s)
}
pub fn number(value: &[u8]) -> Result<u32> {
    value
        .try_into()
        .map(u32::from_le_bytes)
        .map_err(|_| "Invalid bridge integer".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_roundtrip() {
        let bytes = frame(1, 42, &[b"abc", "ñ🙂".as_bytes()]).unwrap();
        let body = read(&mut &bytes[..]).unwrap().unwrap();
        assert_eq!(body[0], 1);
        assert_eq!(number(&body[1..5]).unwrap(), 42);
        assert_eq!(
            fields(&body[5..]).unwrap(),
            vec![&b"abc"[..], "ñ🙂".as_bytes()]
        );
    }
    #[test]
    fn invalid_lengths_and_ids() {
        assert!(fields(&[3, 0, 0, 0, 1]).is_err());
        assert!(read(&mut &[255, 255, 255, 255][..]).is_err());
        assert!(read(&mut &[6, 0, 0, 0, 1][..]).is_err());
        assert!(id(b"../../outside").is_err());
        assert!(id(b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").is_err());
        assert!(frame(1, 1, &[&vec![0; MAX_FRAME]]).is_err());
    }
}
