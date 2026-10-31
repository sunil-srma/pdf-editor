package com.example.pdfeditor.service;

import com.example.pdfeditor.model.FontFamily;
import com.itextpdf.io.font.PdfEncodings;
import com.itextpdf.io.font.constants.StandardFonts;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.font.PdfFontFactory;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Chooses the font used to draw text edits. A bundled family (see {@link FontCatalog}) is embedded in the PDF;
 * the standard families use the standard PDF fonts (Helvetica, Times, Courier) whenever they can represent
 * the text; otherwise an installed Unicode font is embedded. One instance must be used per
 * {@link com.itextpdf.kernel.pdf.PdfDocument} because fonts belong to a document.
 */
final class FontProvider {

    private static final String REPLACEMENT = "?";

    // regular, bold, italic, bold italic
    private static final String[][] STANDARD = {
            {StandardFonts.HELVETICA, StandardFonts.HELVETICA_BOLD, StandardFonts.HELVETICA_OBLIQUE, StandardFonts.HELVETICA_BOLDOBLIQUE},
            {StandardFonts.TIMES_ROMAN, StandardFonts.TIMES_BOLD, StandardFonts.TIMES_ITALIC, StandardFonts.TIMES_BOLDITALIC},
            {StandardFonts.COURIER, StandardFonts.COURIER_BOLD, StandardFonts.COURIER_OBLIQUE, StandardFonts.COURIER_BOLDOBLIQUE}
    };

    // Installed font files to try, in order of preference, for each family: regular, bold, italic, bold italic.
    private static final String[][][] FALLBACKS = {
            {
                    {"DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"},
                    {"NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "NotoSans-Italic.ttf", "NotoSans-BoldItalic.ttf"},
                    {"segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf"},
                    {"arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"},
                    {"LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf"},
                    {"FreeSans.ttf", "FreeSansBold.ttf", "FreeSansOblique.ttf", "FreeSansBoldOblique.ttf"}
            },
            {
                    {"DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSerif-Italic.ttf", "DejaVuSerif-BoldItalic.ttf"},
                    {"NotoSerif-Regular.ttf", "NotoSerif-Bold.ttf", "NotoSerif-Italic.ttf", "NotoSerif-BoldItalic.ttf"},
                    {"times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"},
                    {"LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf", "LiberationSerif-Italic.ttf", "LiberationSerif-BoldItalic.ttf"},
                    {"FreeSerif.ttf", "FreeSerifBold.ttf", "FreeSerifItalic.ttf", "FreeSerifBoldItalic.ttf"}
            },
            {
                    {"DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf", "DejaVuSansMono-Oblique.ttf", "DejaVuSansMono-BoldOblique.ttf"},
                    {"NotoSansMono-Regular.ttf", "NotoSansMono-Bold.ttf", "NotoSansMono-Regular.ttf", "NotoSansMono-Bold.ttf"},
                    {"consola.ttf", "consolab.ttf", "consolai.ttf", "consolaz.ttf"},
                    {"cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"},
                    {"LiberationMono-Regular.ttf", "LiberationMono-Bold.ttf", "LiberationMono-Italic.ttf", "LiberationMono-BoldItalic.ttf"},
                    {"FreeMono.ttf", "FreeMonoBold.ttf", "FreeMonoOblique.ttf", "FreeMonoBoldOblique.ttf"}
            }
    };

    /** A font together with the text it should draw (characters it cannot show are substituted). */
    record Resolved(PdfFont font, String text) {
    }

    private final SystemFonts systemFonts;
    private final FontCatalog catalog;
    private final Map<String, PdfFont> cache = new HashMap<>();

    FontProvider(SystemFonts systemFonts, FontCatalog catalog) {
        this.systemFonts = systemFonts;
        this.catalog = catalog;
    }

    Resolved resolve(String family, boolean bold, boolean italic, String text, Set<String> warnings) {
        Optional<FontFamily> bundled = catalog.find(family).filter(found -> !found.standard());
        int familyIndex = bundled.map(found -> categoryIndex(found.category())).orElseGet(() -> familyIndex(family));
        int style = (bold ? 1 : 0) + (italic ? 2 : 0);

        PdfFont best = bundled.map(found -> bundledFont(found, bold, italic)).orElse(null);
        boolean preferStandard = best == null;
        if (preferStandard) {
            best = standard(STANDARD[familyIndex][style]);
        }
        Set<Integer> missing = unsupported(best, text);
        if (missing.isEmpty()) {
            return new Resolved(best, text);
        }

        if (!preferStandard) {
            // A bundled family can lack a character the standard font of its category has (for example "×").
            PdfFont plain = standard(STANDARD[familyIndex][style]);
            Set<Integer> plainMissing = unsupported(plain, text);
            if (plainMissing.size() < missing.size()) {
                best = plain;
                missing = plainMissing;
            }
            if (missing.isEmpty()) {
                return new Resolved(best, text);
            }
        }

        for (Path candidate : fallbackCandidates(familyIndex, style)) {
            PdfFont font = embedded(candidate);
            if (font == null) {
                continue;
            }
            Set<Integer> stillMissing = unsupported(font, text);
            if (stillMissing.size() < missing.size()) {
                best = font;
                missing = stillMissing;
            }
            if (missing.isEmpty()) {
                return new Resolved(best, text);
            }
        }

        warnings.add("Some characters are not available in any installed font and were replaced with '"
                + REPLACEMENT + "': " + describe(missing));
        return new Resolved(best, substitute(best, text, missing));
    }

    private static int categoryIndex(String category) {
        return switch (category) {
            case "serif" -> 1;
            case "mono" -> 2;
            default -> 0;
        };
    }

    private static int familyIndex(String family) {
        String value = family == null ? "" : family.toLowerCase(Locale.ROOT);
        if (value.contains("mono") || value.contains("courier")) {
            return 2;
        }
        if (value.contains("serif") && !value.contains("sans") || value.contains("times")) {
            return 1;
        }
        return 0;
    }

    private List<Path> fallbackCandidates(int familyIndex, int style) {
        List<Path> candidates = new ArrayList<>();
        // The requested style of every font first, then the regular weights as a last resort.
        for (int s : style == 0 ? new int[]{0} : new int[]{style, 0}) {
            for (String[] names : FALLBACKS[familyIndex]) {
                addIfInstalled(candidates, names[s]);
            }
            if (familyIndex != 0) {
                for (String[] names : FALLBACKS[0]) {
                    addIfInstalled(candidates, names[s]);
                }
            }
        }
        return candidates;
    }

    private void addIfInstalled(List<Path> candidates, String fileName) {
        Optional<Path> path = systemFonts.find(fileName);
        if (path.isPresent() && !candidates.contains(path.get())) {
            candidates.add(path.get());
        }
    }

    private PdfFont standard(String name) {
        return cache.computeIfAbsent("standard:" + name, key -> {
            try {
                return PdfFontFactory.createFont(name);
            } catch (IOException e) {
                throw new UncheckedIOException("Cannot create font " + name, e);
            }
        });
    }

    private PdfFont bundledFont(FontFamily family, boolean bold, boolean italic) {
        String file = family.faceFile(bold, italic);
        if (file == null) {
            return null;
        }
        String key = "bundled:" + file;
        if (cache.containsKey(key)) {
            return cache.get(key);
        }
        PdfFont font = null;
        try {
            Optional<byte[]> bytes = catalog.read(file);
            if (bytes.isPresent()) {
                font = PdfFontFactory.createFont(bytes.get(), PdfEncodings.IDENTITY_H,
                        PdfFontFactory.EmbeddingStrategy.PREFER_EMBEDDED);
            }
        } catch (IOException | RuntimeException e) {
            // Unreadable bundled file: the standard font of the same category is used instead.
        }
        cache.put(key, font);
        return font;
    }

    private PdfFont embedded(Path path) {
        String key = "file:" + path;
        if (cache.containsKey(key)) {
            return cache.get(key);
        }
        PdfFont font = null;
        try {
            font = PdfFontFactory.createFont(path.toString(), PdfEncodings.IDENTITY_H,
                    PdfFontFactory.EmbeddingStrategy.PREFER_EMBEDDED);
        } catch (IOException | RuntimeException e) {
            // Unreadable or unsupported font file: simply try the next candidate.
        }
        cache.put(key, font);
        return font;
    }

    private static Set<Integer> unsupported(PdfFont font, String text) {
        Set<Integer> missing = new LinkedHashSet<>();
        text.codePoints().forEach(codePoint -> {
            if (codePoint >= 0x20 && !font.containsGlyph(codePoint)) {
                missing.add(codePoint);
            }
        });
        return missing;
    }

    private static String substitute(PdfFont font, String text, Set<Integer> missing) {
        boolean canReplace = font.containsGlyph(REPLACEMENT.codePointAt(0));
        StringBuilder result = new StringBuilder(text.length());
        text.codePoints().forEach(codePoint -> {
            if (!missing.contains(codePoint)) {
                result.appendCodePoint(codePoint);
            } else if (canReplace) {
                result.append(REPLACEMENT);
            }
        });
        return result.toString();
    }

    private static String describe(Set<Integer> missing) {
        StringBuilder sb = new StringBuilder();
        int shown = 0;
        for (int codePoint : missing) {
            if (shown++ == 8) {
                sb.append(" …");
                break;
            }
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.appendCodePoint(codePoint);
        }
        return sb.toString();
    }
}
