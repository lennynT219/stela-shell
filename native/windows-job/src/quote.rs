// Encode argv for the Microsoft CRT parser. CreateProcessW receives an explicit
// application path; no shell, command concatenation, UTF-8 loss, or interpolation.
#[cfg(any(windows, test))]
pub fn command_line(args: &[Vec<u16>]) -> Result<Vec<u16>, &'static str> {
    let mut output = Vec::new();
    for (index, arg) in args.iter().enumerate() {
        if arg.contains(&0) {
            return Err("arguments cannot contain NUL");
        }
        if index != 0 {
            output.push(b' ' as u16);
        }
        output.push(b'"' as u16);
        let mut slashes = 0;
        for &unit in arg {
            if unit == b'\\' as u16 {
                slashes += 1;
            } else {
                if unit == b'"' as u16 {
                    output.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2 + 1));
                } else {
                    output.extend(std::iter::repeat_n(b'\\' as u16, slashes));
                }
                slashes = 0;
                output.push(unit);
            }
        }
        output.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
        output.push(b'"' as u16);
    }
    output.push(0);
    if output.len() > 32767 {
        return Err("Windows command line exceeds 32767 UTF-16 units");
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::command_line;

    fn encode(args: &[&str]) -> String {
        let args: Vec<_> = args
            .iter()
            .map(|arg| arg.encode_utf16().collect())
            .collect();
        let result = command_line(&args).unwrap();
        String::from_utf16(&result[..result.len() - 1]).unwrap()
    }

    #[test]
    fn quotes_empty_spaces_unicode_and_shell_metacharacters() {
        assert_eq!(
            encode(&["C:\\Program Files\\pi.exe", "", "ñ🙂 & | % !"]),
            "\"C:\\Program Files\\pi.exe\" \"\" \"ñ🙂 & | % !\""
        );
    }

    #[test]
    fn escapes_quotes_and_trailing_backslashes() {
        assert_eq!(
            encode(&["a\"b", "C:\\path\\", "\\\""]),
            "\"a\\\"b\" \"C:\\path\\\\\" \"\\\\\\\"\""
        );
    }

    #[test]
    fn rejects_nul_and_overlong_input() {
        assert!(command_line(&[vec![0]]).is_err());
        assert!(command_line(&[vec![b'a' as u16; 32767]]).is_err());
    }
}
