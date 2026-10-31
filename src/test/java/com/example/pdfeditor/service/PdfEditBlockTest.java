package com.example.pdfeditor.service;

import com.example.pdfeditor.model.PdfEdit;
import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.geom.Rectangle;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static com.example.pdfeditor.service.PdfFixtures.toDisplay;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

/** Rotation, alignment, decorations, opacity and bundled fonts of text blocks, and rotated images. */
class PdfEditBlockTest {

    private static final double TOLERANCE = 0.02;
    private static final Rectangle PAGE = new Rectangle(0, 0, 400, 600);

    /** Exposes no installed font, so that results do not depend on the machine. */
    private static final SystemFonts NO_SYSTEM_FONTS = new SystemFonts() {
        @Override
        public Optional<Path> find(String fileName) {
            return Optional.empty();
        }
    };

    private final PdfEditService service = new PdfEditService(NO_SYSTEM_FONTS, new FontCatalog());

    private PdfEditResult apply(byte[] pdf, PdfEdit... edits) {
        return service.applyEdits(pdf, List.of(edits));
    }

    /** The texts drawn by the edits, without the "Original" line of the fixture. */
    private static List<PdfInspector.Text> added(PdfEditResult result) {
        List<PdfInspector.Text> texts = PdfInspector.of(result.pdf(), 1).texts();
        return texts.subList(1, texts.size());
    }

    // --------------------------------------------------------------- rotation

    @ParameterizedTest
    @CsvSource({
            "0,0", "0,30", "0,90", "0,180", "0,270", "0,450", "0,-90",
            "90,0", "90,45", "90,90", "180,0", "180,135", "270,0", "270,200"
    })
    void rotatedTextStartsAtItsOriginAndFollowsTheRotatedBaseline(int pageRotation, double rotation) {
        byte[] pdf = PdfFixtures.pdf(1, new PageSize(400, 600), pageRotation, null);
        boolean sideways = pageRotation == 90 || pageRotation == 270;
        PdfEdit edit = Edits.addText().at(150, 200).origin(150, 220).text("Rotate me").fontSize(20.0)
                .rotation(rotation).viewport(sideways ? 600 : 400, sideways ? 400 : 600).build();

        PdfInspector.Text text = added(apply(pdf, edit)).get(0);

        double[] start = toDisplay(pageRotation, PAGE, text.x(), text.y());
        double[] end = toDisplay(pageRotation, PAGE, text.endX(), text.endY());
        double[] top = toDisplay(pageRotation, PAGE, text.x() + text.upX(), text.y() + text.upY());
        double radians = Math.toRadians(rotation);
        double length = Math.hypot(end[0] - start[0], end[1] - start[1]);
        assertThat(start[0]).isCloseTo(150, within(TOLERANCE));
        assertThat(start[1]).isCloseTo(220, within(TOLERANCE));
        assertThat(length).isGreaterThan(40);
        assertThat((end[0] - start[0]) / length).isCloseTo(Math.cos(radians), within(1e-3));
        assertThat((end[1] - start[1]) / length).isCloseTo(Math.sin(radians), within(1e-3));
        // The letters stand on the baseline: "up" is a quarter turn anticlockwise from the writing direction.
        assertThat(top[0] - start[0]).isCloseTo(Math.sin(radians), within(1e-3));
        assertThat(top[1] - start[1]).isCloseTo(-Math.cos(radians), within(1e-3));
        assertThat(text.fontSize()).isCloseTo(20, within(0.01));
    }

    @Test
    void theCoverOfAReplacedTextDoesNotRotateWithTheNewText() {
        PdfEdit edit = Edits.replace().box(100, 100, 80, 14).origin(100, 111).text("Hello").fontSize(12.0)
                .rotation(90).viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        Rectangle cover = page.fills().get(0).bounds();
        assertThat(cover.getLeft()).isCloseTo(100, within(0.01f));
        assertThat(cover.getBottom()).isCloseTo(792 - 114, within(0.01f));
        assertThat(cover.getWidth()).isCloseTo(80, within(0.01f));
        assertThat(cover.getHeight()).isCloseTo(14, within(0.01f));
        // A quarter turn clockwise on the page is three quarter turns anticlockwise in user space.
        assertThat(page.texts().get(1).angle()).isEqualTo(270);
    }

    @Test
    void linesOfARotatedBlockStayStackedPerpendicularToTheBaseline() {
        PdfEdit edit = Edits.addText().at(300, 100).origin(300, 100).text("one\ntwo\nthree").fontSize(10.0)
                .rotation(90).viewport(612, 792).build();

        List<PdfInspector.Text> lines = added(apply(PdfFixtures.letter(), edit));

        // Turned clockwise, the lines run downwards and every next line lies 12 units further to the left.
        assertThat(lines).extracting(PdfInspector.Text::text).containsExactly("one", "two", "three");
        for (int i = 0; i < lines.size(); i++) {
            assertThat(lines.get(i).x()).isCloseTo(300 - 12.0 * i, within(TOLERANCE));
            assertThat(lines.get(i).y()).isCloseTo(792 - 100, within(TOLERANCE));
            assertThat(lines.get(i).endY()).isLessThan(lines.get(i).y());
        }
    }

    // -------------------------------------------------- alignment, line height

    @ParameterizedTest
    @CsvSource({"left", "center", "right", "CENTER", "' right '"})
    void alignmentPlacesEachLineInsideTheBlockWidth(String align) {
        PdfEdit edit = Edits.addText().at(50, 100).origin(50, 120).text("i\nWWWW\nmm").fontSize(20.0)
                .boxWidth(200).align(align).viewport(612, 792).build();

        List<PdfInspector.Text> lines = added(apply(PdfFixtures.letter(), edit));

        assertThat(lines).hasSize(3);
        double narrow = lines.get(0).endX() - lines.get(0).x();
        double wide = lines.get(1).endX() - lines.get(1).x();
        assertThat(wide).isGreaterThan(narrow + 20);
        for (PdfInspector.Text line : lines) {
            double width = line.endX() - line.x();
            switch (align.trim().toLowerCase()) {
                case "left" -> assertThat(line.x()).isCloseTo(50, within(TOLERANCE));
                case "center" -> assertThat(line.x() + width / 2).isCloseTo(150, within(TOLERANCE));
                default -> assertThat(line.endX()).isCloseTo(250, within(TOLERANCE));
            }
        }
    }

    @Test
    void withoutABoxWidthTheBlockIsAsWideAsItsWidestLine() {
        PdfEdit edit = Edits.addText().at(50, 100).origin(50, 120).text("i\nWWWW").fontSize(20.0)
                .align("right").viewport(612, 792).build();

        List<PdfInspector.Text> lines = added(apply(PdfFixtures.letter(), edit));

        assertThat(lines.get(1).x()).isCloseTo(50, within(TOLERANCE));
        assertThat(lines.get(0).endX()).isCloseTo(lines.get(1).endX(), within(TOLERANCE));
        assertThat(lines.get(0).x()).isGreaterThan(50);
    }

    @Test
    void alignmentFollowsTheRotationOfTheBlock() {
        PdfEdit edit = Edits.addText().at(300, 100).origin(300, 100).text("Hi").fontSize(20.0)
                .boxWidth(200).align("right").rotation(90).viewport(612, 792).build();

        PdfInspector.Text line = added(apply(PdfFixtures.letter(), edit)).get(0);

        // The block is 200 units long downwards from the origin and the text ends at its far end.
        assertThat(line.endX()).isCloseTo(300, within(TOLERANCE));
        assertThat(line.endY()).isCloseTo(792 - 300, within(TOLERANCE));
    }

    @Test
    void lineHeightScalesTheDistanceBetweenBaselines() {
        PdfEdit edit = Edits.addText().at(50, 100).origin(50, 100).text("a\nb\nc").fontSize(10.0).lineHeight(2.0)
                .viewport(612, 792).build();

        List<PdfInspector.Text> lines = added(apply(PdfFixtures.letter(), edit));

        assertThat(lines.get(0).y()).isCloseTo(792 - 100, within(TOLERANCE));
        assertThat(lines.get(1).y()).isCloseTo(792 - 120, within(TOLERANCE));
        assertThat(lines.get(2).y()).isCloseTo(792 - 140, within(TOLERANCE));
    }

    // ---------------------------------------------------------- decorations

    @Test
    void underlineAndStrikethroughAreStrokedInTheTextColour() {
        PdfEdit edit = Edits.addText().at(50, 100).origin(50, 120).text("Underlined").fontSize(20.0)
                .color("#ff0000").underline().strikethrough().viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        PdfInspector.Text text = page.texts().get(1);
        assertThat(page.lines()).hasSize(2);
        PdfInspector.Line underline = page.lines().get(0);
        PdfInspector.Line strikethrough = page.lines().get(1);
        assertThat(underline.x1()).isCloseTo(text.x(), within(TOLERANCE));
        assertThat(underline.x2()).isCloseTo(text.endX(), within(TOLERANCE));
        assertThat(underline.y1()).isCloseTo(792 - 120 - 0.13 * 20, within(TOLERANCE));
        assertThat(underline.y2()).isCloseTo(underline.y1(), within(1e-3));
        assertThat(underline.width()).isCloseTo(0.065 * 20, within(1e-3));
        assertThat(underline.rgb()).containsExactly(1f, 0f, 0f);
        assertThat(strikethrough.x1()).isCloseTo(text.x(), within(TOLERANCE));
        assertThat(strikethrough.x2()).isCloseTo(text.endX(), within(TOLERANCE));
        assertThat(strikethrough.y1()).isCloseTo(792 - 120 + 0.28 * 20, within(TOLERANCE));
    }

    @Test
    void textWithoutDecorationsDrawsNoLines() {
        PdfEdit edit = Edits.addText().at(50, 100).text("Plain").fontSize(20.0).viewport(612, 792).build();

        assertThat(PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1).lines()).isEmpty();
    }

    @Test
    void decorationsFollowTheRotationAndSkipBlankLines() {
        PdfEdit edit = Edits.addText().at(300, 100).origin(300, 100).text("Hi\n\nYo").fontSize(20.0)
                .underline().rotation(90).viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), edit).pdf(), 1);

        List<PdfInspector.Text> texts = page.texts().subList(1, page.texts().size());
        assertThat(texts).hasSize(2);
        assertThat(page.lines()).hasSize(2);
        for (int i = 0; i < 2; i++) {
            PdfInspector.Text text = texts.get(i);
            PdfInspector.Line line = page.lines().get(i);
            // Below the baseline of text turned 90° clockwise is one step to the left on the page.
            assertThat(line.x1()).isCloseTo(text.x() - 0.13 * 20, within(TOLERANCE));
            assertThat(line.y1()).isCloseTo(text.y(), within(TOLERANCE));
            assertThat(line.x2()).isCloseTo(text.endX() - 0.13 * 20, within(TOLERANCE));
            assertThat(line.y2()).isCloseTo(text.endY(), within(TOLERANCE));
        }
    }

    // --------------------------------------------------------------- opacity

    @Test
    void opacityAppliesToTheEditAndItsDecorationsOnly() {
        PdfEdit faded = Edits.addText().at(50, 100).text("Faded").fontSize(20.0).underline().opacity(0.4)
                .viewport(612, 792).build();
        PdfEdit solid = Edits.addText().at(50, 200).text("Solid").fontSize(20.0).viewport(612, 792).build();

        PdfInspector page = PdfInspector.of(apply(PdfFixtures.letter(), faded, solid).pdf(), 1);

        assertThat(page.texts()).extracting(PdfInspector.Text::opacity)
                .containsExactly(1.0, (double) 0.4f, 1.0);
        assertThat(page.lines().get(0).opacity()).isCloseTo(0.4, within(1e-6));
    }

    @Test
    void imagesCanBeFaded() {
        String png = PdfFixtures.base64(PdfFixtures.png(4, 4));
        PdfEdit faded = Edits.addImage().box(10, 10, 50, 50).image(png).opacity(0.5).viewport(612, 792).build();
        PdfEdit solid = Edits.addImage().box(100, 10, 50, 50).image(png).viewport(612, 792).build();

        List<PdfInspector.Picture> pictures =
                PdfInspector.of(apply(PdfFixtures.letter(), faded, solid).pdf(), 1).pictures();

        assertThat(pictures).extracting(PdfInspector.Picture::opacity).containsExactly(0.5, 1.0);
    }

    // -------------------------------------------------------- rotated images

    @ParameterizedTest
    @CsvSource({"0,90", "0,45", "0,180", "0,-90", "90,30", "180,45", "270,90"})
    void imagesTurnAroundTheCentreOfTheirBox(int pageRotation, double rotation) {
        byte[] pdf = PdfFixtures.pdf(1, new PageSize(400, 600), pageRotation, null);
        boolean sideways = pageRotation == 90 || pageRotation == 270;
        String png = PdfFixtures.base64(PdfFixtures.png(8, 4));
        PdfEdit edit = Edits.addImage().box(100, 200, 120, 60).image(png).rotation(rotation)
                .viewport(sideways ? 600 : 400, sideways ? 400 : 600).build();

        PdfInspector.Picture picture = PdfInspector.of(apply(pdf, edit).pdf(), 1).pictures().get(0);

        double[] origin = toDisplay(pageRotation, PAGE, picture.e(), picture.f());
        double[] right = toDisplay(pageRotation, PAGE, picture.e() + picture.a(), picture.f() + picture.b());
        double[] up = toDisplay(pageRotation, PAGE, picture.e() + picture.c(), picture.f() + picture.d());
        double[] opposite = toDisplay(pageRotation, PAGE, picture.e() + picture.a() + picture.c(),
                picture.f() + picture.b() + picture.d());
        double radians = Math.toRadians(rotation);
        // The width axis turns clockwise by the rotation, the height axis (pointing up) stays perpendicular.
        assertThat(right[0] - origin[0]).isCloseTo(120 * Math.cos(radians), within(TOLERANCE));
        assertThat(right[1] - origin[1]).isCloseTo(120 * Math.sin(radians), within(TOLERANCE));
        assertThat(up[0] - origin[0]).isCloseTo(60 * Math.sin(radians), within(TOLERANCE));
        assertThat(up[1] - origin[1]).isCloseTo(-60 * Math.cos(radians), within(TOLERANCE));
        // The centre of the image stays at the centre of its box.
        assertThat((origin[0] + opposite[0]) / 2).isCloseTo(160, within(TOLERANCE));
        assertThat((origin[1] + opposite[1]) / 2).isCloseTo(230, within(TOLERANCE));
    }

    // ------------------------------------------------------------ validation

    @Test
    void rejectsInvalidBlockSettingsAndNamesTheField() {
        byte[] pdf = PdfFixtures.letter();

        assertThatThrownBy(() -> apply(pdf, Edits.addText().at(1, 1).text("a").rotation(Double.NaN).build()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'rotation' must be a finite number");
        assertThatThrownBy(() -> apply(pdf, Edits.addText().at(1, 1).text("a").align("justify").build()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'align'");
        assertThatThrownBy(() -> apply(pdf, Edits.addText().at(1, 1).text("a").lineHeight(0.1).build()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'lineHeight'");
        assertThatThrownBy(() -> apply(pdf, Edits.addText().at(1, 1).text("a").lineHeight(9).build()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'lineHeight'");
        assertThatThrownBy(() -> apply(pdf, Edits.addText().at(1, 1).text("a").opacity(-0.1).build()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'opacity'");
        assertThatThrownBy(() -> apply(pdf, Edits.addText().at(1, 1).text("a").opacity(1.1).build()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'opacity'");
        assertThatThrownBy(() -> apply(pdf, Edits.addText().at(1, 1).text("a").boxWidth(0).build()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'boxWidth' must be greater than 0");
    }

    @Test
    void rejectsInvalidImageSettings() {
        String png = PdfFixtures.base64(PdfFixtures.png(4, 4));
        byte[] pdf = PdfFixtures.letter();

        assertThatThrownBy(() -> apply(pdf, Edits.addImage().box(1, 1, 10, 10).image(png).rotation(Double.NaN)
                .viewport(612, 792).build()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'rotation'");
        assertThatThrownBy(() -> apply(pdf, Edits.addImage().box(1, 1, 10, 10).image(png).opacity(2)
                .viewport(612, 792).build()))
                .isInstanceOf(InvalidEditException.class).hasMessageContaining("'opacity'");
    }

    @Test
    void aBlankAlignmentMeansLeft() {
        PdfEdit edit = Edits.addText().at(50, 100).origin(50, 120).text("Hi").boxWidth(200).align("  ")
                .fontSize(20.0).viewport(612, 792).build();

        assertThat(added(apply(PdfFixtures.letter(), edit)).get(0).x()).isCloseTo(50, within(TOLERANCE));
    }
}
