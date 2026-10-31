package com.example.pdfeditor.model;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record TextEdit(
        @Min(1) int page,
        @NotNull double x,
        @NotNull double y,
        @NotNull double fontSize,
        @NotNull double pageWidth,
        @NotNull double pageHeight,
        @NotBlank String text
) {
}
