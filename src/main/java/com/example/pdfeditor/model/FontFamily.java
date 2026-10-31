package com.example.pdfeditor.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

/**
 * A font family a text edit can use ({@code fontFamily} of an edit is its {@code id}).
 *
 * @param id        value of {@code PdfEdit.fontFamily}
 * @param label     name shown to the user
 * @param category  "sans", "serif", "mono" or "handwriting"; used to group fonts and to pick a fallback
 * @param standard  true for the three standard PDF families, which are not embedded in the PDF
 * @param webFamily name under which the browser registers the bundled files; absent for standard families
 * @param css       CSS {@code font-family} stack that reproduces the family in the browser
 * @param faces     file names of the bundled faces by style ("regular", "bold", "italic", "boldItalic");
 *                  a style that is missing falls back to the closest one. Empty for standard families.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record FontFamily(
        String id,
        String label,
        String category,
        boolean standard,
        String webFamily,
        String css,
        Map<String, String> faces
) {
    public static final String REGULAR = "regular";
    public static final String BOLD = "bold";
    public static final String ITALIC = "italic";
    public static final String BOLD_ITALIC = "boldItalic";

    /**
     * File of the face that best matches the requested style: bold italic falls back to bold, then to
     * italic, then to regular. Null when the family has no files.
     */
    public String faceFile(boolean bold, boolean italic) {
        String[] order;
        if (bold && italic) {
            order = new String[]{BOLD_ITALIC, BOLD, ITALIC, REGULAR};
        } else if (bold) {
            order = new String[]{BOLD, REGULAR};
        } else if (italic) {
            order = new String[]{ITALIC, REGULAR};
        } else {
            order = new String[]{REGULAR};
        }
        for (String style : order) {
            String file = faces.get(style);
            if (file != null) {
                return file;
            }
        }
        return null;
    }
}
