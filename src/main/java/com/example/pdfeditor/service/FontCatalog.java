package com.example.pdfeditor.service;

import com.example.pdfeditor.model.FontFamily;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The fonts a text edit can use: the three standard PDF families plus the open-source families bundled in
 * {@code src/main/resources/fonts}. It is the single source of truth for drawing (the PDF) and, through
 * {@code GET /api/fonts}, for the live preview, so both use exactly the same glyphs.
 */
@Component
public class FontCatalog {

    private static final Logger log = LoggerFactory.getLogger(FontCatalog.class);
    private static final String RESOURCE_DIRECTORY = "fonts/";
    private static final String[] ALL_STYLES = {
            FontFamily.REGULAR, FontFamily.BOLD, FontFamily.ITALIC, FontFamily.BOLD_ITALIC};
    private static final String[] NO_ITALIC = {FontFamily.REGULAR, FontFamily.BOLD};

    private static final List<FontFamily> DEFINED = List.of(
            standard("sans", "Helvetica", "sans",
                    "Helvetica, Arial, \"Liberation Sans\", \"Nimbus Sans\", sans-serif"),
            standard("serif", "Times", "serif",
                    "\"Times New Roman\", Times, \"Liberation Serif\", \"Nimbus Roman\", serif"),
            standard("mono", "Courier", "mono",
                    "\"Courier New\", Courier, \"Liberation Mono\", \"Nimbus Mono PS\", monospace"),
            bundled("opensans", "Open Sans", "sans", "OpenSans", "ttf", ALL_STYLES),
            bundled("roboto", "Roboto", "sans", "Roboto", "ttf", ALL_STYLES),
            bundled("montserrat", "Montserrat", "sans", "Montserrat", "ttf", ALL_STYLES),
            bundled("carlito", "Calibri (Carlito)", "sans", "Carlito", "ttf", ALL_STYLES),
            bundled("caladea", "Cambria (Caladea)", "serif", "Caladea", "ttf", ALL_STYLES),
            bundled("courierprime", "Courier Prime", "mono", "CourierPrime", "otf", ALL_STYLES),
            bundled("dancingscript", "Dancing Script", "handwriting", "DancingScript", "otf", NO_ITALIC),
            bundled("comicneue", "Comic Neue", "handwriting", "ComicNeue", "otf", ALL_STYLES));

    private final List<FontFamily> families;
    private final Map<String, FontFamily> byId = new LinkedHashMap<>();
    private final Set<String> files = new HashSet<>();
    private final Map<String, byte[]> contents = new ConcurrentHashMap<>();

    public FontCatalog() {
        List<FontFamily> available = new ArrayList<>();
        for (FontFamily family : DEFINED) {
            FontFamily usable = family.standard() ? family : withExistingFaces(family);
            if (usable != null) {
                available.add(usable);
                byId.put(usable.id(), usable);
                files.addAll(usable.faces().values());
            }
        }
        this.families = List.copyOf(available);
    }

    /** All usable families; the standard ones come first. */
    public List<FontFamily> families() {
        return families;
    }

    /** @param id family id, compared case-insensitively; null and unknown ids yield an empty result */
    public Optional<FontFamily> find(String id) {
        return id == null ? Optional.empty() : Optional.ofNullable(byId.get(id.trim().toLowerCase(Locale.ROOT)));
    }

    /** Content of a bundled font file; only files of the catalog can be read. */
    public Optional<byte[]> read(String fileName) {
        if (fileName == null || !files.contains(fileName)) {
            return Optional.empty();
        }
        byte[] bytes = contents.computeIfAbsent(fileName, FontCatalog::load);
        return Optional.of(bytes);
    }

    /** Media type of a bundled font file. */
    public static String contentType(String fileName) {
        return fileName.toLowerCase(Locale.ROOT).endsWith(".otf") ? "font/otf" : "font/ttf";
    }

    private static byte[] load(String fileName) {
        try (InputStream in = new ClassPathResource(RESOURCE_DIRECTORY + fileName).getInputStream()) {
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read bundled font " + fileName, e);
        }
    }

    /** Drops faces whose file is missing; a family without a regular face is not offered at all. */
    private static FontFamily withExistingFaces(FontFamily family) {
        Map<String, String> faces = new LinkedHashMap<>();
        family.faces().forEach((style, file) -> {
            if (new ClassPathResource(RESOURCE_DIRECTORY + file).exists()) {
                faces.put(style, file);
            } else {
                log.warn("Bundled font file {} of '{}' is missing", file, family.id());
            }
        });
        if (!faces.containsKey(FontFamily.REGULAR)) {
            log.warn("Font family '{}' is not offered because its regular face is missing", family.id());
            return null;
        }
        return new FontFamily(family.id(), family.label(), family.category(), false, family.webFamily(),
                family.css(), Collections.unmodifiableMap(faces));
    }

    private static FontFamily standard(String id, String label, String category, String css) {
        return new FontFamily(id, label, category, true, null, css, Map.of());
    }

    private static FontFamily bundled(String id, String label, String category, String filePrefix,
                                      String extension, String[] styles) {
        Map<String, String> faces = new LinkedHashMap<>();
        for (String style : styles) {
            String suffix = switch (style) {
                case FontFamily.BOLD -> "Bold";
                case FontFamily.ITALIC -> "Italic";
                case FontFamily.BOLD_ITALIC -> "BoldItalic";
                default -> "Regular";
            };
            faces.put(style, filePrefix + "-" + suffix + "." + extension);
        }
        String webFamily = "pdfedit-" + id;
        String generic = switch (category) {
            case "serif" -> "serif";
            case "mono" -> "monospace";
            case "handwriting" -> "cursive";
            default -> "sans-serif";
        };
        return new FontFamily(id, label, category, false, webFamily, "\"" + webFamily + "\", " + generic, faces);
    }
}
