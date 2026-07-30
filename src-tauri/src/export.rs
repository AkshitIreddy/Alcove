//! PDF export assembly (wave 2, roadmap item 23).
//!
//! The frontend rasterizes every book page to a JPEG at 2x through the flip
//! snapshot pipeline (src/editor/script/exporters/capture.ts) and hands the
//! per-page bytes to `export_pdf`, which assembles a complete PDF and writes
//! it to the user-chosen path. Assembly is dependency-free: PDF embeds raw
//! JPEG streams verbatim via the DCTDecode filter, so no imaging or PDF
//! crate is needed. The TypeScript twin (browser dev fallback) lives in
//! src/editor/script/exporters/pdf.ts — keep the object layout in sync.
//!
//! Registration (orchestrator): add `mod export;` in lib.rs and
//! `export::export_pdf` to the `tauri::generate_handler![]` list. No new
//! crates required.

use serde::Deserialize;

/// Captures run at 2x of CSS px (96 dpi) → 192 image pixels per paper inch.
const DEFAULT_PX_PER_INCH: f64 = 192.0;
const PDF_POINTS_PER_INCH: f64 = 72.0;

/// One page image as sent over IPC (field names match the JS payload).
#[derive(Debug, Clone, Deserialize)]
pub struct PdfPageImage {
    /// Raw JPEG bytes (SOI…EOI), embedded verbatim.
    pub jpeg: Vec<u8>,
    /// Pixel width of the JPEG.
    pub width: u32,
    /// Pixel height of the JPEG.
    pub height: u32,
}

/// Fixed-point points value (2 decimals, trailing zeros trimmed).
fn pts(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    let mut s = format!("{rounded:.2}");
    while s.ends_with('0') {
        s.pop();
    }
    if s.ends_with('.') {
        s.pop();
    }
    s
}

/// Assemble a PDF (1.4) from JPEG page images. Object layout mirrors the TS
/// assembler: 1 catalog, 2 pages, then per page i: 3+3i page, 4+3i image
/// XObject, 5+3i content stream.
pub fn build_jpeg_pdf(pages: &[PdfPageImage], px_per_inch: f64) -> Result<Vec<u8>, String> {
    if pages.is_empty() {
        return Err("at least one page image is required".into());
    }
    let density = if px_per_inch.is_finite() && px_per_inch > 0.0 {
        px_per_inch
    } else {
        DEFAULT_PX_PER_INCH
    };
    let scale = PDF_POINTS_PER_INCH / density;

    let mut out: Vec<u8> = Vec::new();
    let object_count = 2 + pages.len() * 3;
    let mut offsets: Vec<usize> = vec![0; object_count];

    let page_object_id = |i: usize| 3 + 3 * i;
    let image_object_id = |i: usize| 4 + 3 * i;
    let content_object_id = |i: usize| 5 + 3 * i;

    out.extend_from_slice(b"%PDF-1.4\n");
    // Binary marker comment line.
    out.extend_from_slice(&[0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

    let begin_object = |out: &mut Vec<u8>, offsets: &mut Vec<usize>, id: usize| {
        offsets[id - 1] = out.len();
        out.extend_from_slice(format!("{id} 0 obj\n").as_bytes());
    };

    begin_object(&mut out, &mut offsets, 1);
    out.extend_from_slice(b"<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    begin_object(&mut out, &mut offsets, 2);
    let kids = pages
        .iter()
        .enumerate()
        .map(|(i, _)| format!("{} 0 R", page_object_id(i)))
        .collect::<Vec<_>>()
        .join(" ");
    out.extend_from_slice(
        format!(
            "<< /Type /Pages /Kids [{kids}] /Count {} >>\nendobj\n",
            pages.len()
        )
        .as_bytes(),
    );

    for (i, page) in pages.iter().enumerate() {
        let px_w = page.width.max(1);
        let px_h = page.height.max(1);
        let w = pts(px_w as f64 * scale);
        let h = pts(px_h as f64 * scale);

        begin_object(&mut out, &mut offsets, page_object_id(i));
        out.extend_from_slice(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] \
                 /Resources << /XObject << /Im0 {} 0 R >> >> /Contents {} 0 R >>\nendobj\n",
                image_object_id(i),
                content_object_id(i)
            )
            .as_bytes(),
        );

        begin_object(&mut out, &mut offsets, image_object_id(i));
        out.extend_from_slice(
            format!(
                "<< /Type /XObject /Subtype /Image /Width {px_w} /Height {px_h} \
                 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode \
                 /Length {} >>\nstream\n",
                page.jpeg.len()
            )
            .as_bytes(),
        );
        out.extend_from_slice(&page.jpeg);
        out.extend_from_slice(b"\nendstream\nendobj\n");

        let content = format!("q\n{w} 0 0 {h} 0 0 cm\n/Im0 Do\nQ\n");
        begin_object(&mut out, &mut offsets, content_object_id(i));
        out.extend_from_slice(
            format!(
                "<< /Length {} >>\nstream\n{content}endstream\nendobj\n",
                content.len()
            )
            .as_bytes(),
        );
    }

    let xref_offset = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n", object_count + 1).as_bytes());
    out.extend_from_slice(b"0000000000 65535 f \n");
    for offset in &offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            object_count + 1
        )
        .as_bytes(),
    );

    Ok(out)
}

/// Assemble the received page JPEGs into a PDF and write it to `path`
/// (already chosen by the user through the save dialog). Returns the path.
#[tauri::command]
pub async fn export_pdf(
    path: String,
    pages: Vec<PdfPageImage>,
    px_per_inch: Option<f64>,
) -> Result<String, String> {
    if !path.to_ascii_lowercase().ends_with(".pdf") {
        return Err("export path must end with .pdf".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = build_jpeg_pdf(&pages, px_per_inch.unwrap_or(DEFAULT_PX_PER_INCH))?;
        std::fs::write(&path, bytes).map_err(|e| format!("could not write PDF: {e}"))?;
        Ok(path)
    })
    .await
    .map_err(|e| format!("export task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_jpeg(len: usize) -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
        bytes.resize(len.max(6) - 2, 0xAB);
        bytes.extend_from_slice(&[0xFF, 0xD9]);
        bytes
    }

    fn pages2() -> Vec<PdfPageImage> {
        vec![
            PdfPageImage { jpeg: fake_jpeg(64), width: 1240, height: 1750 },
            PdfPageImage { jpeg: fake_jpeg(48), width: 1240, height: 1750 },
        ]
    }

    #[test]
    fn header_trailer_and_count() {
        let pdf = build_jpeg_pdf(&pages2(), 192.0).unwrap();
        assert!(pdf.starts_with(b"%PDF-1.4\n"));
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/Count 2"));
        assert!(text.ends_with("%%EOF\n"));
    }

    #[test]
    fn startxref_points_at_xref_table() {
        let pdf = build_jpeg_pdf(&pages2(), 192.0).unwrap();
        let text = String::from_utf8_lossy(&pdf);
        let idx = text.rfind("startxref\n").unwrap();
        let tail = &text[idx + "startxref\n".len()..];
        let offset: usize = tail.lines().next().unwrap().trim().parse().unwrap();
        assert_eq!(&pdf[offset..offset + 4], b"xref");
    }

    #[test]
    fn xref_offsets_point_at_objects() {
        let pdf = build_jpeg_pdf(&pages2(), 192.0).unwrap();
        let text = String::from_utf8_lossy(&pdf);
        let xref_at = text.rfind("xref\n0 9\n").unwrap();
        // Lines: "xref", "0 9", the free entry, then 8 object entries.
        let entries: Vec<&str> = text[xref_at..].lines().skip(3).take(8).collect();
        for (i, entry) in entries.iter().enumerate() {
            let offset: usize = entry[..10].parse().unwrap();
            let expected = format!("{} 0 obj", i + 1);
            assert_eq!(
                &text[offset..offset + expected.len()],
                expected.as_str(),
                "object {} offset mismatch",
                i + 1
            );
        }
    }

    #[test]
    fn jpeg_bytes_embedded_verbatim() {
        let pages = pages2();
        let pdf = build_jpeg_pdf(&pages, 192.0).unwrap();
        let needle = &pages[0].jpeg;
        assert!(pdf
            .windows(needle.len())
            .any(|window| window == needle.as_slice()));
    }

    #[test]
    fn page_size_maps_pixels_to_points() {
        // 1240px at 192 px/inch → 465 pt (1240 / 192 * 72 = 465).
        let pdf = build_jpeg_pdf(&pages2(), 192.0).unwrap();
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/MediaBox [0 0 465 656.25]"));
    }

    #[test]
    fn empty_pages_rejected() {
        assert!(build_jpeg_pdf(&[], 192.0).is_err());
    }
}
