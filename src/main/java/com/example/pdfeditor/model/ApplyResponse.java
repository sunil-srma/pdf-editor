package com.example.pdfeditor.model;

import java.util.List;

/** JSON result of applying edits: the edited PDF plus non-fatal warnings (for example unsupported glyphs). */
public record ApplyResponse(String pdfBase64, List<String> warnings) {
}
