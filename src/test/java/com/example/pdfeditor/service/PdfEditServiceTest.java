package com.example.pdfeditor.service;

import com.example.pdfeditor.model.PdfEdit;
import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.geom.Rectangle;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfReader;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static com.example.pdfeditor.service.PdfFixtures.toDisplay;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

class PdfEditServiceTest {

    private final FontCatalog catalog = new FontCatalog();
    private final PdfEditService service = new PdfEditService(new SystemFonts(), catalog);

    private PdfEditResult apply(byte[] pdf, PdfEdit... edits) {
        return service.applyEdits(pdf, List.of(edits));
    }

    /** iText writes colour components with limited precision, so compare with a tolerance. */
    private static void assertRgb(float[] actual, int red, int green, int blue) {
        assertThat(actual).hasSize(3);
        assertThat(actual[0]).isCloseTo(red / 255f, within(0.001f));
        assertThat(actual[1]).isCloseTo(green / 255f, within(0.001f));
        assertThat(actual[2]).isCloseTo(blue / 255f, within(0.001f));
    }

    private static int pageCount(byte[] pdf) {
        try (PdfDocument document = new PdfDocument(new PdfReader(new ByteArrayInputStream(pdf)))) {
            return document.getNumberOfPages();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    // ------------------------------------------------------------------ text

    @Test
    void replaceCoversTheOriginalBoxAndDrawsTheNewTextAtTheGivenBaseline() {
        PdfEdit edit = Edits.replace().box(100, 100, 80, 14).origin(100, 111).text("Hello").fontSize(12.0)
                .viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        assertThat(page.fills()).hasSize(1);
        PdfInspector.Fill cover = page.fills().get(0);
        assertThat(cover.bounds().getLeft()).isCloseTo(100, within(0.01f));
        assertThat(cover.bounds().getBottom()).isCloseTo(792 - 114, within(0.01f));
        assertThat(cover.bounds().getWidth()).isCloseTo(80, within(0.01f));
        assertThat(cover.bounds().getHeight()).isCloseTo(14, within(0.01f));
        assertRgb(cover.rgb(), 255, 255, 255);

        PdfInspector.Text text = page.texts().get(1);
        assertThat(text.text()).isEqualTo("Hello");
        assertThat(text.x()).isCloseTo(100, within(0.01));
        assertThat(text.y()).isCloseTo(792 - 111, within(0.01));
        assertThat(text.fontSize()).isCloseTo(12, within(0.01));
        assertThat(text.angle()).isZero();
    }

    @Test
    void coverSizeComesFromTheOriginalBoxNotFromTheNewText() {
        PdfEdit shortOriginal = Edits.replace().box(10, 10, 20, 12).origin(10, 20)
                .text("A much longer replacement text").fontSize(12.0).viewport(612, 792).build();

        PdfInspector.Fill cover = PdfInspector.of(apply(PdfFixtures.letter(), shortOriginal).pdf(), 1).fills().get(0);

        assertThat(cover.bounds().getWidth()).isCloseTo(20, within(0.01f));
    }

    @Test
    void replaceUsesTheGivenBackgroundAndTextColours() {
        PdfEdit edit = Edits.replace().box(10, 10, 50, 12).origin(10, 20).text("X").fontSize(12.0)
                .background("#102030").color("#ff0000").viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        assertRgb(page.fills().get(0).rgb(), 16, 32, 48);
        assertThat(page.texts()).hasSize(2);
    }

    @Test
    void replaceWithBlankTextOnlyCoversTheOriginal() {
        PdfEdit edit = Edits.replace().box(10, 10, 50, 12).origin(10, 20).text("   ").fontSize(12.0)
                .viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        assertThat(page.fills()).hasSize(1);
        assertThat(page.texts()).extracting(PdfInspector.Text::text).containsExactly("Original");
    }

    @Test
    void replaceWithoutABoxBehavesLikeAddText() {
        PdfEdit edit = Edits.replace().at(30, 40).text("Plain").fontSize(10.0).viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        assertThat(page.fills()).isEmpty();
        PdfInspector.Text text = page.texts().get(1);
        assertThat(text.x()).isCloseTo(30, within(0.01));
        assertThat(text.y()).isCloseTo(792 - 50, within(0.01));
    }

    @Test
    void addTextDefaultsTheBaselineToOneFontSizeBelowTheTop() {
        PdfEdit edit = Edits.addText().at(100, 100).text("Note").fontSize(20.0).viewport(612, 792).build();

        PdfInspector.Text text = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1).texts().get(1);

        assertThat(text.x()).isCloseTo(100, within(0.01));
        assertThat(text.y()).isCloseTo(792 - 120, within(0.01));
        assertThat(text.fontSize()).isCloseTo(20, within(0.01));
    }

    @Test
    void addTextUsesDefaultFontSizeWhenNoneIsGiven() {
        PdfEdit edit = Edits.addText().at(100, 100).text("Note").viewport(612, 792).build();

        PdfInspector.Text text = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1).texts().get(1);

        assertThat(text.fontSize()).isCloseTo(12, within(0.01));
    }

    @Test
    void multiLineTextIsSetLineByLine() {
        PdfEdit edit = Edits.addText().at(50, 100).origin(50, 100).text("one\r\ntwo\n\nfour").fontSize(10.0)
                .viewport(612, 792).build();

        List<PdfInspector.Text> texts = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1).texts();

        assertThat(texts).extracting(PdfInspector.Text::text).containsExactly("Original", "one", "two", "four");
        assertThat(texts.get(1).y()).isCloseTo(792 - 100, within(0.01));
        assertThat(texts.get(2).y()).isCloseTo(792 - 112, within(0.01));
        assertThat(texts.get(3).y()).isCloseTo(792 - 136, within(0.01));
    }

    @Test
    void tabsAndInvisibleCharactersAreNormalised() {
        PdfEdit edit = Edits.addText().at(50, 100).text("a\tb\u200Bc\uFEFF").fontSize(10.0).viewport(612, 792).build();

        PdfEditResult result = apply(PdfFixtures.letter(), edit);

        assertThat(PdfInspector.of(result.pdf(), 1).texts().get(1).text()).isEqualTo("a    bc");
        assertThat(result.warnings()).isEmpty();
    }

    @Test
    void clientUnitsOfAnyScaleAreConvertedToPoints() {
        // The client measured on a page twice as large as the PDF page (scale 2).
        PdfEdit edit = Edits.replace().box(200, 200, 160, 28).origin(200, 222).text("Zoomed").fontSize(24.0)
                .viewport(1224, 1584).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        PdfInspector.Fill cover = page.fills().get(0);
        assertThat(cover.bounds().getLeft()).isCloseTo(100, within(0.01f));
        assertThat(cover.bounds().getBottom()).isCloseTo(792 - 114, within(0.01f));
        assertThat(cover.bounds().getWidth()).isCloseTo(80, within(0.01f));
        PdfInspector.Text text = page.texts().get(1);
        assertThat(text.x()).isCloseTo(100, within(0.01));
        assertThat(text.y()).isCloseTo(792 - 111, within(0.01));
        assertThat(text.fontSize()).isCloseTo(12, within(0.01));
    }

    @ParameterizedTest
    @CsvSource({
            "sans,false,false,Helvetica",
            "sans,true,false,Helvetica-Bold",
            "sans,false,true,Helvetica-Oblique",
            "sans,true,true,Helvetica-BoldOblique",
            "serif,false,false,Times-Roman",
            "serif,true,true,Times-BoldItalic",
            "mono,false,false,Courier",
            "mono,true,false,Courier-Bold",
            "Times New Roman,false,false,Times-Roman",
            "Courier New,false,true,Courier-Oblique",
            "Arial,false,false,Helvetica"
    })
    void fontFamilyBoldAndItalicSelectTheStandardFont(String family, boolean bold, boolean italic, String expected) {
        PdfEdit edit = Edits.addText().at(50, 100).text("Styled").fontSize(12.0).font(family, bold, italic)
                .viewport(612, 792).build();

        PdfEditResult result = apply(PdfFixtures.letter(), edit);

        assertThat(PdfInspector.of(result.pdf(), 1).texts().get(1).fontName()).isEqualTo(expected);
    }

    @Test
    void latin1AndWinAnsiCharactersNeedNoFallbackFont() {
        PdfEdit edit = Edits.addText().at(50, 100).text("Café – “quoted” € 5 •").fontSize(12.0)
                .viewport(612, 792).build();

        PdfEditResult result = apply(PdfFixtures.letter(), edit);

        assertThat(result.warnings()).isEmpty();
        PdfInspector.Text text = PdfInspector.of(result.pdf(), 1).texts().get(1);
        assertThat(text.fontName()).isEqualTo("Helvetica");
        assertThat(text.text()).isEqualTo("Café – “quoted” € 5 •");
    }

    // ----------------------------------------------------------------- fonts

    /** Only exposes the given files, so that results do not depend on the fonts installed on the machine. */
    private static SystemFonts fontsFrom(Map<String, Path> fonts) {
        return new SystemFonts() {
            @Override
            public Optional<Path> find(String fileName) {
                return Optional.ofNullable(fonts.get(fileName));
            }
        };
    }

    private static Path liberationSans() {
        try {
            return Path.of(PdfEditServiceTest.class
                    .getResource("/static/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf").toURI());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void charactersMissingFromTheStandardFontsUseAnInstalledFont() {
        PdfEditService withFonts = new PdfEditService(fontsFrom(Map.of("DejaVuSans.ttf", liberationSans())), catalog);
        PdfEdit edit = Edits.addText().at(50, 100).text("Łódź Привет").fontSize(12.0).viewport(612, 792).build();

        PdfEditResult result = withFonts.applyEdits(PdfFixtures.letter(), List.of(edit));

        assertThat(result.warnings()).isEmpty();
        PdfInspector.Text text = PdfInspector.of(result.pdf(), 1).texts().get(1);
        assertThat(text.text()).isEqualTo("Łódź Привет");
        assertThat(text.fontName()).contains("Liberation");
    }

    @Test
    void charactersNoFontCanDrawAreReplacedAndReportedOnce() {
        PdfEditService withFonts = new PdfEditService(fontsFrom(Map.of("DejaVuSans.ttf", liberationSans())), catalog);
        PdfEdit first = Edits.addText().at(50, 100).text("Total ₹500").fontSize(12.0).viewport(612, 792).build();
        PdfEdit second = Edits.addText().at(50, 130).text("Net ₹400").fontSize(12.0).viewport(612, 792).build();

        PdfEditResult result = withFonts.applyEdits(PdfFixtures.letter(), List.of(first, second));

        assertThat(result.warnings()).hasSize(1);
        assertThat(result.warnings().get(0)).contains("₹");
        assertThat(PdfInspector.of(result.pdf(), 1).texts())
                .extracting(PdfInspector.Text::text)
                .containsExactly("Original", "Total ?500", "Net ?400");
    }

    @Test
    void withoutAnyInstalledFontNonLatin1CharactersAreReplaced() {
        PdfEditService noFonts = new PdfEditService(fontsFrom(Map.of()), catalog);
        PdfEdit edit = Edits.addText().at(50, 100).text("Łódź").fontSize(12.0).viewport(612, 792).build();

        PdfEditResult result = noFonts.applyEdits(PdfFixtures.letter(), List.of(edit));

        assertThat(result.warnings()).hasSize(1);
        assertThat(PdfInspector.of(result.pdf(), 1).texts().get(1).text()).isEqualTo("?ód?");
    }

    // --------------------------------------------------- erase/highlight/image

    @Test
    void eraseDrawsAWhiteRectangleByDefault() {
        PdfEdit edit = Edits.erase().box(50, 60, 100, 20).viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        assertThat(page.fills()).hasSize(1);
        PdfInspector.Fill fill = page.fills().get(0);
        assertThat(fill.bounds().getLeft()).isCloseTo(50, within(0.01f));
        assertThat(fill.bounds().getBottom()).isCloseTo(792 - 80, within(0.01f));
        assertThat(fill.bounds().getWidth()).isCloseTo(100, within(0.01f));
        assertThat(fill.bounds().getHeight()).isCloseTo(20, within(0.01f));
        assertRgb(fill.rgb(), 255, 255, 255);
        assertThat(fill.blendMode()).isEqualTo("Normal");
    }

    @Test
    void eraseUsesTheSampledBackgroundColour() {
        PdfEdit edit = Edits.erase().box(50, 60, 100, 20).background("#336699").viewport(612, 792).build();

        PdfInspector.Fill fill = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1).fills().get(0);

        assertRgb(fill.rgb(), 0x33, 0x66, 0x99);
    }

    @Test
    void highlightMultipliesYellowOverTheText() {
        PdfEdit edit = Edits.highlight().box(50, 60, 100, 20).viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        PdfInspector.Fill fill = page.fills().get(0);
        assertThat(fill.blendMode()).isEqualTo("Multiply");
        assertRgb(fill.rgb(), 255, 255, 0);
        assertThat(fill.bounds().getBottom()).isCloseTo(792 - 80, within(0.01f));
    }

    @Test
    void highlightColourCanBeChangedAndDoesNotLeakIntoLaterEdits() {
        PdfEdit highlight = Edits.highlight().box(50, 60, 100, 20).color("#00ff00").viewport(612, 792).build();
        PdfEdit erase = Edits.erase().box(50, 200, 100, 20).viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), highlight, erase).pdf(), 1);

        assertRgb(page.fills().get(0).rgb(), 0, 255, 0);
        assertThat(page.fills().get(0).blendMode()).isEqualTo("Multiply");
        assertThat(page.fills().get(1).blendMode()).isEqualTo("Normal");
        assertRgb(page.fills().get(1).rgb(), 255, 255, 255);
    }

    @Test
    void imagesAreScaledAndPlacedInsideTheirBox() {
        String png = PdfFixtures.base64(PdfFixtures.png(8, 4));
        PdfEdit edit = Edits.addImage().box(100, 200, 120, 60).image(png).viewport(612, 792).build();

        PdfInspector.Picture picture = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1).pictures().get(0);

        assertThat(picture.a()).isCloseTo(120, within(0.01));
        assertThat(picture.b()).isZero();
        assertThat(picture.c()).isZero();
        assertThat(picture.d()).isCloseTo(60, within(0.01));
        assertThat(picture.e()).isCloseTo(100, within(0.01));
        assertThat(picture.f()).isCloseTo(792 - 260, within(0.01));
    }

    @Test
    void imageDataUrlsAreAccepted() {
        String dataUrl = "data:image/png;base64," + PdfFixtures.base64(PdfFixtures.png(4, 4));
        PdfEdit edit = Edits.addImage().box(10, 10, 40, 40).image(dataUrl).viewport(612, 792).build();

        assertThat(PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1).pictures()).hasSize(1);
    }

    // ------------------------------------------------- page geometry (E2E)

    @ParameterizedTest
    @CsvSource({"0,false", "90,false", "180,false", "270,false", "0,true", "90,true", "180,true", "270,true"})
    void editsLandWhereTheUserSawThemOnRotatedAndCroppedPages(int rotation, boolean cropped) {
        Rectangle media = new Rectangle(0, 0, 400, 600);
        Rectangle visible = cropped ? new Rectangle(20, 30, 360, 540) : media;
        byte[] pdf = PdfFixtures.pdf(1, new PageSize(400, 600), rotation, cropped ? visible : null);
        boolean sideways = rotation == 90 || rotation == 270;
        double displayedWidth = sideways ? visible.getHeight() : visible.getWidth();
        double displayedHeight = sideways ? visible.getWidth() : visible.getHeight();
        double scale = 1.5; // client units per point
        double vw = displayedWidth * scale;
        double vh = displayedHeight * scale;

        PdfEdit replace = Edits.replace().box(30 * scale, 40 * scale, 90 * scale, 15 * scale)
                .origin(30 * scale, 52 * scale).text("Moved").fontSize(12 * scale).viewport(vw, vh).build();
        PdfEdit highlight = Edits.highlight().box(60 * scale, 100 * scale, 70 * scale, 12 * scale)
                .viewport(vw, vh).build();
        PdfEdit image = Edits.addImage().box(20 * scale, 150 * scale, 50 * scale, 25 * scale)
                .image(PdfFixtures.base64(PdfFixtures.png(4, 2))).viewport(vw, vh).build();

        PdfInspector page = PdfInspector.of(apply(pdf, replace, highlight, image).pdf(), 1);

        PdfInspector.Fill cover = page.fills().get(0);
        double[] a = toDisplay(rotation, visible, cover.bounds().getLeft(), cover.bounds().getBottom());
        double[] b = toDisplay(rotation, visible, cover.bounds().getRight(), cover.bounds().getTop());
        assertThat(Math.min(a[0], b[0])).isCloseTo(30, within(0.01));
        assertThat(Math.min(a[1], b[1])).isCloseTo(40, within(0.01));
        assertThat(Math.abs(a[0] - b[0])).isCloseTo(90, within(0.01));
        assertThat(Math.abs(a[1] - b[1])).isCloseTo(15, within(0.01));

        PdfInspector.Text text = page.texts().get(1);
        double[] origin = toDisplay(rotation, visible, text.x(), text.y());
        assertThat(origin[0]).isCloseTo(30, within(0.01));
        assertThat(origin[1]).isCloseTo(52, within(0.01));
        assertThat(text.angle()).isEqualTo(rotation);
        assertThat(text.fontSize()).isCloseTo(12, within(0.01));
        double[] end = toDisplay(rotation, visible, text.endX(), text.endY());
        assertThat(end[0]).isGreaterThan(origin[0]);
        assertThat(end[1]).isCloseTo(52, within(0.01));

        PdfInspector.Fill marker = page.fills().get(1);
        double[] m1 = toDisplay(rotation, visible, marker.bounds().getLeft(), marker.bounds().getBottom());
        double[] m2 = toDisplay(rotation, visible, marker.bounds().getRight(), marker.bounds().getTop());
        assertThat(Math.min(m1[0], m2[0])).isCloseTo(60, within(0.01));
        assertThat(Math.min(m1[1], m2[1])).isCloseTo(100, within(0.01));
        assertThat(Math.abs(m1[0] - m2[0])).isCloseTo(70, within(0.01));
        assertThat(Math.abs(m1[1] - m2[1])).isCloseTo(12, within(0.01));

        PdfInspector.Picture picture = page.pictures().get(0);
        double[] bottomLeft = toDisplay(rotation, visible, picture.e(), picture.f());
        double[] right = toDisplay(rotation, visible, picture.e() + picture.a(), picture.f() + picture.b());
        double[] up = toDisplay(rotation, visible, picture.e() + picture.c(), picture.f() + picture.d());
        assertThat(bottomLeft[0]).isCloseTo(20, within(0.01));
        assertThat(bottomLeft[1]).isCloseTo(175, within(0.01));
        assertThat(right[0] - bottomLeft[0]).isCloseTo(50, within(0.01));
        assertThat(right[1] - bottomLeft[1]).isCloseTo(0, within(0.01));
        assertThat(up[0] - bottomLeft[0]).isCloseTo(0, within(0.01));
        assertThat(up[1] - bottomLeft[1]).isCloseTo(-25, within(0.01));
    }

    // --------------------------------------------------------- document level

    @Test
    void originalContentIsKeptAndEditsAreDrawnAfterIt() {
        PdfEdit edit = Edits.replace().box(50, 730, 60, 14).origin(50, 741).text("New").fontSize(12.0)
                .viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        assertThat(page.items()).hasSize(3);
        assertThat(page.items().get(0)).isInstanceOf(PdfInspector.Text.class);
        assertThat(((PdfInspector.Text) page.items().get(0)).text()).isEqualTo("Original");
        assertThat(page.items().get(1)).isInstanceOf(PdfInspector.Fill.class);
        assertThat(((PdfInspector.Text) page.items().get(2)).text()).isEqualTo("New");
    }

    @Test
    void editsAreAppliedInOrderAndToTheirOwnPages() {
        byte[] pdf = PdfFixtures.pdf(3, PageSize.LETTER, 0, null);
        PdfEdit first = Edits.addText().page(3).at(10, 10).text("third").viewport(612, 792).build();
        PdfEdit second = Edits.addText().page(1).at(10, 10).text("first-a").viewport(612, 792).build();
        PdfEdit third = Edits.addText().page(1).at(10, 40).text("first-b").viewport(612, 792).build();

        byte[] result = apply(pdf, first, second, third).pdf();

        assertThat(pageCount(result)).isEqualTo(3);
        assertThat(PdfInspector.of(result, 1).texts()).extracting(PdfInspector.Text::text)
                .containsExactly("Original", "first-a", "first-b");
        assertThat(PdfInspector.of(result, 2).texts()).extracting(PdfInspector.Text::text)
                .containsExactly("Original");
        assertThat(PdfInspector.of(result, 3).texts()).extracting(PdfInspector.Text::text)
                .containsExactly("Original", "third");
    }

    @Test
    void manyEditsOnOnePageAreAllKept() {
        PdfEdit[] edits = new PdfEdit[200];
        for (int i = 0; i < edits.length; i++) {
            edits[i] = Edits.addText().at(10, 10 + i * 3).text("n" + i).fontSize(2.0).viewport(612, 792).build();
        }

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edits).pdf(), 1);

        assertThat(page.texts()).hasSize(201);
    }

    @Test
    void base64ForDocumentsMayCarryADataUrlPrefixAndLineBreaks() {
        String base64 = PdfFixtures.base64(PdfFixtures.letter());
        String formatted = "data:application/pdf;base64," + base64.substring(0, 40) + "\r\n" + base64.substring(40);
        PdfEdit edit = Edits.addText().at(10, 10).text("x").viewport(612, 792).build();

        PdfEditResult result = service.applyEdits(formatted, List.of(edit));

        assertThat(new String(result.pdf(), 0, 5, StandardCharsets.ISO_8859_1)).isEqualTo("%PDF-");
    }

    @Test
    void colourParsingAcceptsShortAndLongHexAndFallsBack() {
        assertThat(PdfEditService.parseColor("#f00", null).getColorValue()).containsExactly(1f, 0f, 0f);
        assertThat(PdfEditService.parseColor("00FF00", null).getColorValue()).containsExactly(0f, 1f, 0f);
        assertThat(PdfEditService.parseColor("not-a-colour", null)).isNull();
        assertThat(PdfEditService.parseColor("#12345", null)).isNull();
        assertThat(PdfEditService.parseColor(null, null)).isNull();
    }

    // ------------------------------------------------------------ validation

    @Test
    void rejectsEmptyInput() {
        PdfEdit edit = Edits.erase().box(1, 1, 1, 1).build();

        assertThatThrownBy(() -> service.applyEdits(new byte[0], List.of(edit)))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("PDF is empty");
        assertThatThrownBy(() -> service.applyEdits(PdfFixtures.letter(), List.of()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("No edits");
        assertThatThrownBy(() -> service.applyEdits(PdfFixtures.letter(), null))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("No edits");
    }

    @Test
    void rejectsFilesThatAreNotPdfs() {
        PdfEdit edit = Edits.erase().box(1, 1, 1, 1).build();

        assertThatThrownBy(() -> service.applyEdits("this is not a pdf".getBytes(StandardCharsets.UTF_8), List.of(edit)))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("not a valid PDF");
    }

    @Test
    void rejectsInvalidBase64() {
        PdfEdit edit = Edits.erase().box(1, 1, 1, 1).build();

        assertThatThrownBy(() -> service.applyEdits("***", List.of(edit)))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("Base64");
        assertThatThrownBy(() -> service.applyEdits("  ", List.of(edit)))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("required");
    }

    @Test
    void rejectsPasswordProtectedDocuments() {
        PdfEdit edit = Edits.erase().box(1, 1, 1, 1).build();

        assertThatThrownBy(() -> service.applyEdits(PdfFixtures.encrypted("secret"), List.of(edit)))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("password");
    }

    @Test
    void rejectsUnknownEditTypesAndNamesTheOffendingEdit() {
        PdfEdit fine = Edits.erase().box(1, 1, 1, 1).viewport(612, 792).build();
        PdfEdit bad = Edits.of("rotate").page(1).box(1, 1, 1, 1).build();

        assertThatThrownBy(() -> apply(PdfFixtures.letter(), fine, bad))
                .isInstanceOf(InvalidEditException.class)
                .hasMessage("Edit 2 (rotate): unknown edit type 'rotate'");
    }

    @ParameterizedTest
    @CsvSource({"0", "2", "-1"})
    void rejectsPagesThatDoNotExist(int page) {
        PdfEdit edit = Edits.erase().page(page).box(1, 1, 1, 1).build();

        assertThatThrownBy(() -> apply(PdfFixtures.letter(), edit))
                .isInstanceOf(InvalidEditException.class)
                .hasMessageContaining("page " + page + " does not exist");
    }

    @Test
    void rejectsMissingOrInvalidNumbers() {
        assertThatThrownBy(() -> apply(PdfFixtures.letter(), Edits.erase().build()))
                .hasMessageContaining("'x' is required");
        assertThatThrownBy(() -> apply(PdfFixtures.letter(), Edits.erase().box(1, 1, 0, 5).build()))
                .hasMessageContaining("'width' must be greater than 0");
        assertThatThrownBy(() -> apply(PdfFixtures.letter(), Edits.erase().box(Double.NaN, 1, 5, 5).build()))
                .hasMessageContaining("'x' must be a finite number");
        assertThatThrownBy(() -> apply(PdfFixtures.letter(),
                Edits.addText().at(1, 1).text("a").fontSize(0.0).build()))
                .hasMessageContaining("'fontSize'");
        assertThatThrownBy(() -> apply(PdfFixtures.letter(),
                Edits.addText().at(1, 1).text("a").fontSize(100000.0).build()))
                .hasMessageContaining("'fontSize'");
        assertThatThrownBy(() -> apply(PdfFixtures.letter(), Edits.addText().text("a").build()))
                .hasMessageContaining("'x' is required");
    }

    @Test
    void rejectsImagesThatAreMissingOrCannotBeDecoded() {
        PdfEdit missing = Edits.addImage().box(1, 1, 10, 10).viewport(612, 792).build();
        PdfEdit garbage = Edits.addImage().box(1, 1, 10, 10).image(PdfFixtures.base64("garbage".getBytes()))
                .viewport(612, 792).build();

        assertThatThrownBy(() -> apply(PdfFixtures.letter(), missing))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'imageBase64' is required");
        assertThatThrownBy(() -> apply(PdfFixtures.letter(), garbage))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("PNG or JPEG");
    }

    @Test
    void failedRequestsDoNotChangeTheInputBytes() {
        byte[] pdf = PdfFixtures.letter();
        byte[] copy = pdf.clone();
        PdfEdit fine = Edits.erase().box(1, 1, 1, 1).viewport(612, 792).build();
        PdfEdit bad = Edits.erase().page(9).box(1, 1, 1, 1).build();

        assertThatThrownBy(() -> apply(pdf, fine, bad)).isInstanceOf(InvalidEditException.class);

        assertThat(pdf).isEqualTo(copy);
    }
}
