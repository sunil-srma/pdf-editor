package com.example.pdfeditor.service;

import com.example.pdfeditor.model.PdfEdit;
import com.itextpdf.io.image.ImageData;
import com.itextpdf.io.image.ImageDataFactory;
import com.itextpdf.kernel.colors.Color;
import com.itextpdf.kernel.colors.ColorConstants;
import com.itextpdf.kernel.colors.DeviceRgb;
import com.itextpdf.kernel.exceptions.BadPasswordException;
import com.itextpdf.kernel.exceptions.PdfException;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.geom.Rectangle;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfPage;
import com.itextpdf.kernel.pdf.PdfReader;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.kernel.pdf.canvas.PdfCanvas;
import com.itextpdf.kernel.pdf.extgstate.PdfExtGState;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Applies edits (text replacement, added text, erase, highlight, images) to a PDF with iText.
 * <p>
 * Edits are drawn on top of the existing page content: replaced or erased content is hidden under a
 * filled rectangle rather than removed from the content stream.
 */
@Service
public class PdfEditService {

    private static final Set<String> TYPES = Set.of(
            PdfEdit.TYPE_REPLACE, PdfEdit.TYPE_ERASE, PdfEdit.TYPE_ADD_TEXT,
            PdfEdit.TYPE_ADD_IMAGE, PdfEdit.TYPE_HIGHLIGHT);

    private static final double DEFAULT_FONT_SIZE = 12;
    private static final double MAX_FONT_SIZE = 2000;
    private static final double LINE_SPACING = 1.2;
    private static final double MIN_LINE_HEIGHT = 0.5;
    private static final double MAX_LINE_HEIGHT = 5;
    // Text decorations, in multiples of the font size: distance of the line's centre from the baseline
    // (positive is below it) and its thickness. The browser preview uses the same values (fonts.js).
    private static final double UNDERLINE_OFFSET = 0.13;
    private static final double STRIKETHROUGH_OFFSET = -0.28;
    private static final double DECORATION_THICKNESS = 0.065;
    private static final int MAX_TEXT_LENGTH = 20_000;
    private static final int MAX_IMAGE_BYTES = 25 * 1024 * 1024;

    private static final Color YELLOW = new DeviceRgb(255, 255, 0);

    private final SystemFonts systemFonts;
    private final FontCatalog fontCatalog;

    public PdfEditService(SystemFonts systemFonts, FontCatalog fontCatalog) {
        this.systemFonts = systemFonts;
        this.fontCatalog = fontCatalog;
    }

    /** Same as {@link #applyEdits(byte[], List)} for a Base64 encoded PDF. */
    public PdfEditResult applyEdits(String pdfBase64, List<PdfEdit> edits) {
        return applyEdits(decodeBase64(pdfBase64, "pdfBase64"), edits);
    }

    /**
     * Applies all edits, in order, to the PDF.
     *
     * @throws InvalidEditException if the PDF cannot be read or an edit is invalid; nothing is partially applied
     */
    public PdfEditResult applyEdits(byte[] pdfBytes, List<PdfEdit> edits) {
        if (pdfBytes == null || pdfBytes.length == 0) {
            throw new InvalidEditException("The PDF is empty.");
        }
        if (edits == null || edits.isEmpty()) {
            throw new InvalidEditException("No edits provided.");
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream(pdfBytes.length + 16 * 1024);
        Set<String> warnings = new LinkedHashSet<>();
        try (PdfDocument document = open(pdfBytes, out)) {
            Session session = new Session(document, new FontProvider(systemFonts, fontCatalog), warnings);
            for (int i = 0; i < edits.size(); i++) {
                PdfEdit edit = edits.get(i);
                try {
                    session.apply(edit);
                } catch (InvalidEditException e) {
                    throw new InvalidEditException("Edit " + (i + 1) + " (" + edit.type() + "): " + e.getMessage(), e);
                }
            }
        }
        return new PdfEditResult(out.toByteArray(), List.copyOf(warnings));
    }

    /** Decodes Base64, accepting an optional {@code data:...;base64,} prefix and whitespace/line breaks. */
    public static byte[] decodeBase64(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new InvalidEditException("'" + field + "' is required.");
        }
        String data = value;
        int comma = data.indexOf(',');
        if (data.startsWith("data:") && comma > 0) {
            data = data.substring(comma + 1);
        }
        try {
            return Base64.getDecoder().decode(data);
        } catch (IllegalArgumentException strictFailure) {
            // Retry without whitespace; the lenient MIME decoder is avoided because it silently skips invalid characters.
            try {
                return Base64.getDecoder().decode(data.replaceAll("\\s+", ""));
            } catch (IllegalArgumentException e) {
                throw new InvalidEditException("'" + field + "' is not valid Base64.", e);
            }
        }
    }

    private static PdfDocument open(byte[] pdfBytes, OutputStream out) {
        try {
            return new PdfDocument(new PdfReader(new ByteArrayInputStream(pdfBytes)), new PdfWriter(out));
        } catch (BadPasswordException e) {
            throw new InvalidEditException("The PDF is password protected or does not allow modifications.", e);
        } catch (PdfException | com.itextpdf.io.exceptions.IOException | IOException e) {
            throw new InvalidEditException("The file is not a valid PDF: " + e.getMessage(), e);
        }
    }

    /** State shared by all edits applied to one document. */
    private static final class Session {
        private final PdfDocument document;
        private final FontProvider fonts;
        private final Set<String> warnings;
        private final Map<Integer, PdfCanvas> canvases = new HashMap<>();
        private PdfExtGState multiply;

        Session(PdfDocument document, FontProvider fonts, Set<String> warnings) {
            this.document = document;
            this.fonts = fonts;
            this.warnings = warnings;
        }

        void apply(PdfEdit edit) {
            String type = edit.type() == null ? "" : edit.type();
            if (!TYPES.contains(type)) {
                throw new InvalidEditException("unknown edit type '" + type + "'");
            }
            int pageCount = document.getNumberOfPages();
            if (edit.page() < 1 || edit.page() > pageCount) {
                throw new InvalidEditException("page " + edit.page() + " does not exist (the document has "
                        + pageCount + " page(s))");
            }

            PdfPage page = document.getPage(edit.page());
            PageGeometry geometry = PageGeometry.of(page, edit.pageWidth(), edit.pageHeight());
            PdfCanvas canvas = canvases.computeIfAbsent(edit.page(), number -> new PdfCanvas(page));

            switch (type) {
                case PdfEdit.TYPE_REPLACE -> {
                    if (edit.width() != null && edit.height() != null) {
                        cover(canvas, geometry, edit);
                    }
                    drawText(canvas, geometry, edit);
                }
                case PdfEdit.TYPE_ADD_TEXT -> drawText(canvas, geometry, edit);
                case PdfEdit.TYPE_ERASE -> cover(canvas, geometry, edit);
                case PdfEdit.TYPE_HIGHLIGHT -> highlight(canvas, geometry, edit);
                default -> drawImage(canvas, geometry, edit);
            }
        }

        private void cover(PdfCanvas canvas, PageGeometry geometry, PdfEdit edit) {
            Rectangle area = area(geometry, edit);
            canvas.saveState()
                    .setFillColor(parseColor(edit.backgroundColor(), ColorConstants.WHITE))
                    .rectangle(area)
                    .fill()
                    .restoreState();
        }

        private void highlight(PdfCanvas canvas, PageGeometry geometry, PdfEdit edit) {
            Rectangle area = area(geometry, edit);
            if (multiply == null) {
                multiply = new PdfExtGState().setBlendMode(PdfExtGState.BM_MULTIPLY);
            }
            // Multiply keeps the text under the highlight readable, like a real marker.
            canvas.saveState()
                    .setExtGState(multiply)
                    .setFillColor(parseColor(edit.color(), YELLOW))
                    .rectangle(area)
                    .fill()
                    .restoreState();
        }

        private void drawText(PdfCanvas canvas, PageGeometry geometry, PdfEdit edit) {
            String text = normalizeText(edit.text());
            if (text.isBlank()) {
                return;
            }
            double fontSize = edit.fontSize() == null ? DEFAULT_FONT_SIZE : edit.fontSize();
            if (!(fontSize > 0 && fontSize <= MAX_FONT_SIZE)) {
                throw new InvalidEditException("'fontSize' must be greater than 0 and at most " + MAX_FONT_SIZE);
            }
            double originX = edit.textX() != null ? finite(edit.textX(), "textX") : required(edit.x(), "x");
            double baseline = edit.baseline() != null
                    ? finite(edit.baseline(), "baseline")
                    : required(edit.y(), "y") + fontSize;
            double angle = Math.toRadians(rotationOf(edit));
            double pitch = fontSize * lineHeightOf(edit);
            String align = alignOf(edit);
            Double requestedWidth = edit.boxWidth() == null ? null : positive(edit.boxWidth(), "boxWidth");
            double opacity = opacityOf(edit);
            boolean underline = Boolean.TRUE.equals(edit.underline());
            boolean strikethrough = Boolean.TRUE.equals(edit.strikethrough());

            FontProvider.Resolved resolved = fonts.resolve(edit.fontFamily(), Boolean.TRUE.equals(edit.bold()),
                    Boolean.TRUE.equals(edit.italic()), text, warnings);
            PdfFont font = resolved.font();
            String[] lines = resolved.text().split("\n", -1);
            // Widths are in displayed units: text width is proportional to the font size.
            double[] widths = new double[lines.length];
            double widest = 0;
            for (int i = 0; i < lines.length; i++) {
                widths[i] = lines[i].isEmpty() ? 0 : font.getWidth(lines[i], (float) fontSize);
                widest = Math.max(widest, widths[i]);
            }
            double blockWidth = requestedWidth != null ? requestedWidth : widest;

            // Directions on the displayed page: along a line, and from a line to the next one.
            double alongX = Math.cos(angle);
            double alongY = Math.sin(angle);
            double nextX = -alongY;
            double nextY = alongX;
            double[] right = geometry.direction(alongX, alongY);
            double[] up = geometry.direction(alongY, -alongX);
            Color color = parseColor(edit.color(), ColorConstants.BLACK);

            canvas.saveState();
            applyOpacity(canvas, opacity);
            canvas.setFillColor(color)
                    .beginText()
                    .setFontAndSize(font, (float) geometry.lengthY(fontSize));
            for (int i = 0; i < lines.length; i++) {
                if (lines[i].isEmpty()) {
                    continue;
                }
                double shift = alignShift(align, blockWidth, widths[i]);
                double[] origin = geometry.toUser(
                        originX + nextX * pitch * i + alongX * shift,
                        baseline + nextY * pitch * i + alongY * shift);
                canvas.setTextMatrix((float) right[0], (float) right[1], (float) up[0], (float) up[1],
                        (float) origin[0], (float) origin[1]);
                canvas.showText(lines[i]);
            }
            canvas.endText();

            if (underline || strikethrough) {
                canvas.setStrokeColor(color).setLineWidth((float) geometry.lengthY(fontSize * DECORATION_THICKNESS));
                for (int i = 0; i < lines.length; i++) {
                    if (widths[i] <= 0) {
                        continue;
                    }
                    double shift = alignShift(align, blockWidth, widths[i]);
                    double startX = originX + nextX * pitch * i + alongX * shift;
                    double startY = baseline + nextY * pitch * i + alongY * shift;
                    for (double offset : new double[]{underline ? UNDERLINE_OFFSET : Double.NaN,
                            strikethrough ? STRIKETHROUGH_OFFSET : Double.NaN}) {
                        if (Double.isNaN(offset)) {
                            continue;
                        }
                        double[] from = geometry.toUser(startX + nextX * fontSize * offset,
                                startY + nextY * fontSize * offset);
                        double[] to = geometry.toUser(startX + nextX * fontSize * offset + alongX * widths[i],
                                startY + nextY * fontSize * offset + alongY * widths[i]);
                        canvas.moveTo(from[0], from[1]).lineTo(to[0], to[1]).stroke();
                    }
                }
            }
            canvas.restoreState();
        }

        private void drawImage(PdfCanvas canvas, PageGeometry geometry, PdfEdit edit) {
            double x = required(edit.x(), "x");
            double y = required(edit.y(), "y");
            double width = positive(edit.width(), "width");
            double height = positive(edit.height(), "height");
            double angle = Math.toRadians(rotationOf(edit));
            double opacity = opacityOf(edit);

            byte[] bytes = decodeBase64(edit.imageBase64(), "imageBase64");
            if (bytes.length > MAX_IMAGE_BYTES) {
                throw new InvalidEditException("the image is larger than " + MAX_IMAGE_BYTES / (1024 * 1024) + " MB");
            }
            ImageData image;
            try {
                image = ImageDataFactory.create(bytes);
            } catch (RuntimeException e) {
                throw new InvalidEditException("the image format is not supported (use PNG or JPEG)", e);
            }

            // The image turns around the centre of its box. Its width axis and its (upward) height axis follow
            // the displayed page, so a rotated page or a rotated image only changes the matrix.
            double cos = Math.cos(angle);
            double sin = Math.sin(angle);
            double centerX = x + width / 2;
            double centerY = y + height / 2;
            double[] bottomLeft = geometry.toUser(
                    centerX - width / 2 * cos - height / 2 * sin,
                    centerY - width / 2 * sin + height / 2 * cos);
            double[] widthAxis = geometry.vector(width * cos, width * sin);
            double[] heightAxis = geometry.vector(height * sin, -height * cos);
            canvas.saveState();
            applyOpacity(canvas, opacity);
            canvas.addImageWithTransformationMatrix(image,
                    (float) widthAxis[0], (float) widthAxis[1], (float) heightAxis[0], (float) heightAxis[1],
                    (float) bottomLeft[0], (float) bottomLeft[1]);
            canvas.restoreState();
        }

        private static void applyOpacity(PdfCanvas canvas, double opacity) {
            if (opacity < 1) {
                canvas.setExtGState(new PdfExtGState().setFillOpacity((float) opacity).setStrokeOpacity((float) opacity));
            }
        }

        /** Distance from the left edge of the block to the start of a line of the given width. */
        private static double alignShift(String align, double blockWidth, double lineWidth) {
            return switch (align) {
                case "center" -> (blockWidth - lineWidth) / 2;
                case "right" -> blockWidth - lineWidth;
                default -> 0;
            };
        }

        private static Rectangle area(PageGeometry geometry, PdfEdit edit) {
            double x = required(edit.x(), "x");
            double y = required(edit.y(), "y");
            double width = positive(edit.width(), "width");
            double height = positive(edit.height(), "height");
            return geometry.toUserRect(x, y, width, height);
        }
    }

    private static double required(Double value, String name) {
        if (value == null) {
            throw new InvalidEditException("'" + name + "' is required");
        }
        return finite(value, name);
    }

    private static double positive(Double value, String name) {
        double number = required(value, name);
        if (number <= 0) {
            throw new InvalidEditException("'" + name + "' must be greater than 0");
        }
        return number;
    }

    private static double finite(double value, String name) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            throw new InvalidEditException("'" + name + "' must be a finite number");
        }
        return value;
    }

    /** Clockwise rotation in degrees, normalised to [0, 360). */
    private static double rotationOf(PdfEdit edit) {
        if (edit.rotation() == null) {
            return 0;
        }
        double degrees = finite(edit.rotation(), "rotation") % 360;
        return degrees < 0 ? degrees + 360 : degrees;
    }

    private static double lineHeightOf(PdfEdit edit) {
        if (edit.lineHeight() == null) {
            return LINE_SPACING;
        }
        double value = finite(edit.lineHeight(), "lineHeight");
        if (value < MIN_LINE_HEIGHT || value > MAX_LINE_HEIGHT) {
            throw new InvalidEditException("'lineHeight' must be between " + MIN_LINE_HEIGHT + " and " + MAX_LINE_HEIGHT);
        }
        return value;
    }

    private static double opacityOf(PdfEdit edit) {
        if (edit.opacity() == null) {
            return 1;
        }
        double value = finite(edit.opacity(), "opacity");
        if (value < 0 || value > 1) {
            throw new InvalidEditException("'opacity' must be between 0 and 1");
        }
        return value;
    }

    private static String alignOf(PdfEdit edit) {
        if (edit.align() == null || edit.align().isBlank()) {
            return "left";
        }
        String value = edit.align().trim().toLowerCase(Locale.ROOT);
        if (!value.equals("left") && !value.equals("center") && !value.equals("right")) {
            throw new InvalidEditException("'align' must be left, center or right");
        }
        return value;
    }

    /** Unifies line breaks and drops control and zero-width characters that fonts cannot draw. */
    private static String normalizeText(String text) {
        if (text == null) {
            return "";
        }
        if (text.length() > MAX_TEXT_LENGTH) {
            throw new InvalidEditException("the text is longer than " + MAX_TEXT_LENGTH + " characters");
        }
        StringBuilder result = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\r') {
                if (i + 1 < text.length() && text.charAt(i + 1) == '\n') {
                    i++;
                }
                result.append('\n');
            } else if (c == '\n' || c == '\u2028' || c == '\u2029') {
                result.append('\n');
            } else if (c == '\t') {
                result.append("    ");
            } else if (c >= ' ' && !(c >= '\u200B' && c <= '\u200F') && c != '\u2060' && c != '\uFEFF') {
                result.append(c);
            }
        }
        return result.toString();
    }

    /** Parses {@code #rgb} / {@code #rrggbb}; anything else yields the fallback. */
    static Color parseColor(String value, Color fallback) {
        if (value == null) {
            return fallback;
        }
        String hex = value.trim();
        if (hex.startsWith("#")) {
            hex = hex.substring(1);
        }
        if (hex.length() == 3) {
            hex = "" + hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
        }
        if (hex.length() != 6) {
            return fallback;
        }
        try {
            int rgb = Integer.parseInt(hex, 16);
            return new DeviceRgb((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
