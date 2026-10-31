package com.example.pdfeditor.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

/**
 * Unified edit model for PDF operations.
 * <p>
 * type: "replace" | "erase" | "addText" | "addImage" | "highlight"
 * <p>
 * Coordinates are measured from the top-left corner of the page <em>as displayed</em>
 * (after page rotation and cropping), in the units of the viewport that produced them.
 * {@code pageWidth}/{@code pageHeight} give the size of that viewport, so any render scale works.
 * <ul>
 *   <li>{@code x, y, width, height}: the box an edit acts on. For {@code replace} it is the original
 *       text box that gets covered; for {@code erase}/{@code highlight} the affected area; for
 *       {@code addImage} the image box. For {@code addText} only {@code x, y} are used when
 *       {@code textX}/{@code baseline} are absent.</li>
 *   <li>{@code textX, baseline}: origin of the first text line (left edge and baseline). They default
 *       to {@code x} and {@code y + fontSize}.</li>
 *   <li>{@code fontFamily}: the id of a family from {@code GET /api/fonts} ("sans" (default), "serif",
 *       "mono" or a bundled family such as "opensans"); combined with {@code bold}/{@code italic}. A style
 *       the family does not have falls back to the closest one.</li>
 *   <li>{@code color}: text or highlight colour; {@code backgroundColor}: colour used to cover the
 *       original content for {@code replace}/{@code erase} (default white).</li>
 *   <li>{@code rotation}: clockwise angle in degrees on the displayed page (default 0). Text turns around its
 *       origin ({@code textX, baseline}); an image turns around the centre of its box. The cover box of a
 *       {@code replace} is never rotated.</li>
 *   <li>{@code align}: "left" (default), "center" or "right"; lines are aligned inside {@code boxWidth}
 *       (default: the widest line). The server never wraps text: line breaks are the {@code \n} in
 *       {@code text}.</li>
 *   <li>{@code lineHeight}: distance between baselines as a multiple of the font size (default 1.2).</li>
 *   <li>{@code underline}, {@code strikethrough}: text decorations in the text colour.</li>
 *   <li>{@code opacity}: 0 (transparent) to 1 (opaque, default) for text and images.</li>
 * </ul>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PdfEdit(
        @NotBlank String type,
        @Min(1) int page,
        Double x,
        Double y,
        Double width,
        Double height,
        Double fontSize,
        Double pageWidth,
        Double pageHeight,
        String text,
        String imageBase64,
        String color,
        Double textX,
        Double baseline,
        Boolean bold,
        Boolean italic,
        String fontFamily,
        String backgroundColor,
        Double rotation,
        String align,
        Double boxWidth,
        Double lineHeight,
        Boolean underline,
        Boolean strikethrough,
        Double opacity
) {
    public static final String TYPE_REPLACE = "replace";
    public static final String TYPE_ERASE = "erase";
    public static final String TYPE_ADD_TEXT = "addText";
    public static final String TYPE_ADD_IMAGE = "addImage";
    public static final String TYPE_HIGHLIGHT = "highlight";
}
