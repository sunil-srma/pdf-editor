package com.example.pdfeditor.service;

import com.example.pdfeditor.model.PdfEdit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/** The bundled font families are embedded in the PDF and need no font installed on the machine. */
class BundledFontsTest {

    /** Exposes no installed font, so that only the bundled and the standard fonts are available. */
    private static final SystemFonts NO_SYSTEM_FONTS = new SystemFonts() {
        @Override
        public Optional<Path> find(String fileName) {
            return Optional.empty();
        }
    };

    private final PdfEditService service = new PdfEditService(NO_SYSTEM_FONTS, new FontCatalog());

    private PdfEditResult apply(PdfEdit edit) {
        return service.applyEdits(PdfFixtures.letter(), List.of(edit));
    }

    private static PdfEdit text(String family, boolean bold, boolean italic, String text) {
        return Edits.addText().at(50, 100).text(text).fontSize(14.0).font(family, bold, italic)
                .viewport(612, 792).build();
    }

    @ParameterizedTest
    @CsvSource({
            "opensans,false,false,OpenSans",
            "opensans,true,false,OpenSans-Bold",
            "opensans,false,true,OpenSans-Italic",
            "opensans,true,true,OpenSans-BoldItalic",
            "roboto,false,false,Roboto-Regular",
            "roboto,true,true,Roboto-BoldItalic",
            "montserrat,false,false,Montserrat-Regular",
            "montserrat,true,false,Montserrat-Bold",
            "carlito,false,false,Carlito",
            "carlito,true,false,Carlito-Bold",
            "caladea,false,true,Caladea-Italic",
            "caladea,true,true,Caladea-BoldItalic",
            "courierprime,false,false,CourierPrime",
            "comicneue,false,false,ComicNeue",
            "dancingscript,false,false,DancingScript"
    })
    void aBundledFamilyIsEmbeddedWithTheFaceOfTheRequestedStyle(String family, boolean bold, boolean italic,
                                                                String expectedName) {
        PdfEditResult result = apply(text(family, bold, italic, "Hamburgefonstiv"));

        PdfInspector.Text drawn = PdfInspector.of(result.pdf(), 1).texts().get(1);
        String name = drawn.fontName().replace(" ", "");
        assertThat(drawn.text()).isEqualTo("Hamburgefonstiv");
        assertThat(drawn.embedded()).isTrue();
        assertThat(name).contains(expectedName);
        assertThat(name.contains("Bold")).isEqualTo(bold);
        assertThat(name.contains("Italic")).isEqualTo(italic);
        assertThat(result.warnings()).isEmpty();
    }

    @Test
    void familyIdsAreCaseInsensitive() {
        PdfInspector.Text drawn = PdfInspector.of(apply(text("OpenSans", false, false, "Hello")).pdf(), 1)
                .texts().get(1);

        assertThat(drawn.fontName()).contains("OpenSans");
    }

    @Test
    void standardFamiliesStayUnembedded() {
        PdfInspector.Text drawn = PdfInspector.of(apply(text("sans", false, false, "Hello")).pdf(), 1)
                .texts().get(1);

        assertThat(drawn.embedded()).isFalse();
        assertThat(drawn.fontName()).isEqualTo("Helvetica");
    }

    @Test
    void aStyleTheFamilyDoesNotHaveFallsBackToTheClosestFace() {
        // Dancing Script has no italic faces: italic uses regular and bold italic uses bold.
        PdfInspector.Text italic = PdfInspector.of(apply(text("dancingscript", false, true, "Hello")).pdf(), 1)
                .texts().get(1);
        PdfInspector.Text boldItalic = PdfInspector.of(apply(text("dancingscript", true, true, "Hello")).pdf(), 1)
                .texts().get(1);

        assertThat(italic.fontName().replace(" ", "")).contains("DancingScript").doesNotContain("Bold");
        assertThat(boldItalic.fontName().replace(" ", "")).contains("DancingScript-Bold");
    }

    @Test
    void bundledFontsDrawCharactersTheStandardFontsCannotWithoutAnyInstalledFont() {
        PdfEditResult result = apply(text("opensans", false, false, "Łódź Привет Ελλάδα"));

        PdfInspector.Text drawn = PdfInspector.of(result.pdf(), 1).texts().get(1);
        assertThat(drawn.text()).isEqualTo("Łódź Привет Ελλάδα");
        assertThat(drawn.fontName()).contains("OpenSans");
        assertThat(result.warnings()).isEmpty();
    }

    @Test
    void charactersNoAvailableFontCanDrawAreReplacedAndReported() {
        PdfEditResult result = apply(text("opensans", false, false, "Total ₹500"));

        assertThat(result.warnings()).hasSize(1);
        assertThat(result.warnings().get(0)).contains("₹");
        assertThat(PdfInspector.of(result.pdf(), 1).texts().get(1).text()).isEqualTo("Total ?500");
    }

    @Test
    void embeddedFontsAreSubsetSoTheDocumentStaysSmall() {
        PdfEditResult result = apply(text("montserrat", true, true, "A few words"));

        // The Montserrat bold italic file alone is more than 200 KB.
        assertThat(result.pdf().length).isLessThan(PdfFixtures.letter().length + 60_000);
    }

    @Test
    void severalEditsWithTheSameFontEmbedItOnce() {
        PdfEdit first = text("roboto", false, false, "One");
        PdfEdit second = Edits.addText().at(50, 200).text("Two").fontSize(14.0).font("roboto", false, false)
                .viewport(612, 792).build();

        byte[] once = service.applyEdits(PdfFixtures.letter(), List.of(first)).pdf();
        byte[] twice = service.applyEdits(PdfFixtures.letter(), List.of(first, second)).pdf();

        assertThat(twice.length - once.length).isLessThan(2_000);
    }
}
