package com.example.pdfeditor.model;

import java.util.List;

/** Response of {@code GET /api/fonts}. */
public record FontsResponse(List<FontFamily> families) {
}
