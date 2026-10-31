package com.example.pdfeditor.service;

import com.example.pdfeditor.model.FontFamily;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FontCatalogTest {

    private final FontCatalog catalog = new FontCatalog();

    private static FontFamily family(String... styleAndFile) {
        Map<String, String> faces = new LinkedHashMap<>();
        for (int i = 0; i < styleAndFile.length; i += 2) {
            faces.put(styleAndFile[i], styleAndFile[i + 1]);
        }
        return new FontFamily("test", "Test", "sans", false, "pdfedit-test", "\"pdfedit-test\", sans-serif", faces);
    }

    @Test
    void theStandardFamiliesComeFirstFollowedByTheBundledOnes() {
        List<String> ids = catalog.families().stream().map(FontFamily::id).toList();

        assertThat(ids).containsExactly("sans", "serif", "mono", "opensans", "roboto", "montserrat", "carlito",
                "caladea", "courierprime", "dancingscript", "comicneue");
        assertThat(catalog.families().stream().filter(FontFamily::standard)).hasSize(3);
    }

    @Test
    void everyBundledFamilyHasARegularFaceAndReadableFiles() {
        for (FontFamily family : catalog.families()) {
            if (family.standard()) {
                assertThat(family.faces()).isEmpty();
                assertThat(family.webFamily()).isNull();
                continue;
            }
            assertThat(family.faces()).containsKey(FontFamily.REGULAR);
            assertThat(family.webFamily()).isEqualTo("pdfedit-" + family.id());
            assertThat(family.css()).startsWith("\"" + family.webFamily() + "\", ");
            for (String file : family.faces().values()) {
                assertThat(catalog.read(file)).as(file).isPresent();
                assertThat(catalog.read(file).get().length).as(file).isGreaterThan(10_000);
            }
        }
    }

    @Test
    void dancingScriptOffersNoItalicFaces() {
        FontFamily dancing = catalog.find("dancingscript").orElseThrow();

        assertThat(dancing.faces()).containsOnlyKeys(FontFamily.REGULAR, FontFamily.BOLD);
        assertThat(dancing.category()).isEqualTo("handwriting");
    }

    @Test
    void findIgnoresCaseAndSpacesAndToleratesNullAndUnknownIds() {
        assertThat(catalog.find(" OpenSans ")).isPresent();
        assertThat(catalog.find("ROBOTO")).isPresent();
        assertThat(catalog.find(null)).isEmpty();
        assertThat(catalog.find("comic sans")).isEmpty();
    }

    @Test
    void onlyFilesOfTheCatalogCanBeRead() {
        assertThat(catalog.read("OpenSans-Regular.ttf")).isPresent();
        assertThat(catalog.read("NOTICE.txt")).isEmpty();
        assertThat(catalog.read("../static/index.html")).isEmpty();
        assertThat(catalog.read("")).isEmpty();
        assertThat(catalog.read(null)).isEmpty();
    }

    @Test
    void theMediaTypeFollowsTheFileExtension() {
        assertThat(FontCatalog.contentType("A.ttf")).isEqualTo("font/ttf");
        assertThat(FontCatalog.contentType("A.OTF")).isEqualTo("font/otf");
    }

    @Test
    void facesFallBackToTheClosestStyle() {
        FontFamily complete = family("regular", "r", "bold", "b", "italic", "i", "boldItalic", "bi");
        FontFamily upright = family("regular", "r", "bold", "b");
        FontFamily regularOnly = family("regular", "r");
        FontFamily noBold = family("regular", "r", "italic", "i");

        assertThat(complete.faceFile(false, false)).isEqualTo("r");
        assertThat(complete.faceFile(true, false)).isEqualTo("b");
        assertThat(complete.faceFile(false, true)).isEqualTo("i");
        assertThat(complete.faceFile(true, true)).isEqualTo("bi");
        assertThat(upright.faceFile(false, true)).isEqualTo("r");
        assertThat(upright.faceFile(true, true)).isEqualTo("b");
        assertThat(regularOnly.faceFile(true, true)).isEqualTo("r");
        assertThat(noBold.faceFile(true, false)).isEqualTo("r");
        assertThat(noBold.faceFile(true, true)).isEqualTo("i");
        assertThat(family().faceFile(false, false)).isNull();
    }
}
