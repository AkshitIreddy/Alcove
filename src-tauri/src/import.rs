//! Markdown import helpers (wave 2, roadmap item 25).
//!
//! The frontend drives the whole import flow (plugin-dialog picker, tolerant
//! Notebook Script parse, book/page creation); Rust stays minimal — this
//! module only reads a picked file with *encoding tolerance*: Windows
//! Notepad and friends happily save `.md` as UTF-16 (with or without BOM) or
//! UTF-8-with-BOM, which a naive UTF-8 read would garble or reject.
//!
//! Registration (orchestrator): add `mod import;` in lib.rs and
//! `import::read_markdown_file` to the `tauri::generate_handler![]` list.
//! No new crates required.

/// Decode text bytes with BOM sniffing + a UTF-16 zero-byte heuristic.
/// Total: undecodable sequences degrade lossily, never error.
pub fn decode_text_bytes(bytes: &[u8]) -> String {
    // UTF-8 BOM.
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    // UTF-16 LE / BE BOM.
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        return utf16_lossy(&bytes[2..], true);
    }
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        return utf16_lossy(&bytes[2..], false);
    }
    // BOM-less UTF-16 heuristic: ASCII-heavy text stores every other byte as
    // zero. Count zeros at even/odd positions over a bounded prefix.
    let sample = &bytes[..bytes.len().min(4096)];
    if sample.len() >= 8 {
        let (mut even_zero, mut odd_zero) = (0usize, 0usize);
        for (i, b) in sample.iter().enumerate() {
            if *b == 0 {
                if i % 2 == 0 {
                    even_zero += 1;
                } else {
                    odd_zero += 1;
                }
            }
        }
        let half = sample.len() / 2;
        if odd_zero > half / 2 && even_zero < half / 8 {
            return utf16_lossy(bytes, true); // LE: text bytes at even positions
        }
        if even_zero > half / 2 && odd_zero < half / 8 {
            return utf16_lossy(bytes, false); // BE
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn utf16_lossy(bytes: &[u8], little_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks(2)
        .map(|pair| {
            let (a, b) = (pair[0], *pair.get(1).unwrap_or(&0));
            if little_endian {
                u16::from_le_bytes([a, b])
            } else {
                u16::from_be_bytes([a, b])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

/// Read a Markdown/text file with encoding tolerance. Size-capped so a
/// mispicked huge file cannot balloon the webview.
#[tauri::command]
pub async fn read_markdown_file(path: String) -> Result<String, String> {
    const MAX_BYTES: u64 = 8 * 1024 * 1024;
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&path).map_err(|e| format!("could not read file: {e}"))?;
        if meta.len() > MAX_BYTES {
            return Err("file is too large to import (8 MB cap)".into());
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("could not read file: {e}"))?;
        Ok(decode_text_bytes(&bytes))
    })
    .await
    .map_err(|e| format!("import task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "# Hello\n\ncafé — naïve über\n";

    #[test]
    fn plain_utf8_passes_through() {
        assert_eq!(decode_text_bytes(TEXT.as_bytes()), TEXT);
    }

    #[test]
    fn utf8_bom_is_stripped() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(TEXT.as_bytes());
        assert_eq!(decode_text_bytes(&bytes), TEXT);
    }

    #[test]
    fn utf16_le_with_bom_decodes() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in TEXT.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_text_bytes(&bytes), TEXT);
    }

    #[test]
    fn utf16_be_with_bom_decodes() {
        let mut bytes = vec![0xFE, 0xFF];
        for unit in TEXT.encode_utf16() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        assert_eq!(decode_text_bytes(&bytes), TEXT);
    }

    #[test]
    fn bomless_utf16_le_heuristic() {
        let ascii = "# Notes\n\nplain ascii markdown body, long enough to sample.\n";
        let mut bytes = Vec::new();
        for unit in ascii.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_text_bytes(&bytes), ascii);
    }

    #[test]
    fn invalid_utf8_degrades_lossily() {
        let bytes = [b'o', b'k', 0xC3, 0x28, b'!'];
        let decoded = decode_text_bytes(&bytes);
        assert!(decoded.starts_with("ok"));
        assert!(decoded.ends_with('!'));
    }
}
