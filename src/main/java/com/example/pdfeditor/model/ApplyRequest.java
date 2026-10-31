package com.example.pdfeditor.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public record ApplyRequest(
        @NotBlank String pdfBase64,
        @NotEmpty @Size(max = 5000) @Valid List<PdfEdit> edits
) {
}
