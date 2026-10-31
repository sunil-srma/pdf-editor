package com.example.pdfeditor.service;

import java.util.List;

/** Edited PDF bytes plus non-fatal warnings (for example characters that no available font could draw). */
public record PdfEditResult(byte[] pdf, List<String> warnings) {
}
