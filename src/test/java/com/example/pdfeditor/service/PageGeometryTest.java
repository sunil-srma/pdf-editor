package com.example.pdfeditor.service;

import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.geom.Rectangle;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfPage;
import com.itextpdf.kernel.pdf.PdfReader;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class PageGeometryTest {

    private static final PageSize SIZE = new PageSize(400, 600);
    private static final Rectangle CROP = new Rectangle(20, 30, 360, 540);

    private static void withPage(int rotation, Rectangle crop, Consumer<PdfPage> test) {
        byte[] pdf = PdfFixtures.pdf(1, SIZE, rotation, crop);
        try (PdfDocument document = new PdfDocument(new PdfReader(new ByteArrayInputStream(pdf)))) {
            test.accept(document.getPage(1));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void assertPoint(double[] actual, double expectedX, double expectedY) {
        assertThat(actual[0]).isCloseTo(expectedX, within(0.001));
        assertThat(actual[1]).isCloseTo(expectedY, within(0.001));
    }

    @Test
    void unrotatedPageHasItsOriginAtTheTopLeft() {
        withPage(0, null, page -> {
            PageGeometry geometry = PageGeometry.of(page, 400.0, 600.0);
            assertPoint(geometry.toUser(0, 0), 0, 600);
            assertPoint(geometry.toUser(400, 600), 400, 0);
        });
    }

    @Test
    void rotated90TopLeftIsTheUserSpaceBottomLeft() {
        withPage(90, null, page -> {
            PageGeometry geometry = PageGeometry.of(page, 600.0, 400.0);
            assertPoint(geometry.toUser(0, 0), 0, 0);
            assertPoint(geometry.toUser(600, 400), 400, 600);
        });
    }

    @Test
    void rotated180TopLeftIsTheUserSpaceBottomRight() {
        withPage(180, null, page -> {
            PageGeometry geometry = PageGeometry.of(page, 400.0, 600.0);
            assertPoint(geometry.toUser(0, 0), 400, 0);
            assertPoint(geometry.toUser(400, 600), 0, 600);
        });
    }

    @Test
    void rotated270TopLeftIsTheUserSpaceTopRight() {
        withPage(270, null, page -> {
            PageGeometry geometry = PageGeometry.of(page, 600.0, 400.0);
            assertPoint(geometry.toUser(0, 0), 400, 600);
            assertPoint(geometry.toUser(600, 400), 0, 0);
        });
    }

    @Test
    void cropBoxIsTheVisibleAreaForEveryRotation() {
        withPage(0, CROP, page -> {
            PageGeometry geometry = PageGeometry.of(page, 360.0, 540.0);
            assertPoint(geometry.toUser(0, 0), 20, 570);
            assertPoint(geometry.toUser(360, 540), 380, 30);
        });
        withPage(90, CROP, page -> {
            PageGeometry geometry = PageGeometry.of(page, 540.0, 360.0);
            assertPoint(geometry.toUser(0, 0), 20, 30);
            assertPoint(geometry.toUser(540, 360), 380, 570);
        });
        withPage(180, CROP, page -> {
            PageGeometry geometry = PageGeometry.of(page, 360.0, 540.0);
            assertPoint(geometry.toUser(0, 0), 380, 30);
            assertPoint(geometry.toUser(360, 540), 20, 570);
        });
        withPage(270, CROP, page -> {
            PageGeometry geometry = PageGeometry.of(page, 540.0, 360.0);
            assertPoint(geometry.toUser(0, 0), 380, 570);
            assertPoint(geometry.toUser(540, 360), 20, 30);
        });
    }

    @Test
    void clientUnitsAreScaledToPoints() {
        withPage(0, null, page -> {
            PageGeometry geometry = PageGeometry.of(page, 800.0, 1200.0);
            assertPoint(geometry.toUser(100, 100), 50, 550);
            assertThat(geometry.lengthX(100)).isCloseTo(50, within(0.001));
            assertThat(geometry.lengthY(100)).isCloseTo(50, within(0.001));
        });
    }

    @Test
    void withoutViewportSizeOneClientUnitIsOnePoint() {
        withPage(0, null, page -> assertPoint(PageGeometry.of(page, null, null).toUser(10, 20), 10, 580));
    }

    @Test
    void rectanglesStayAxisAlignedAfterRotation() {
        withPage(90, null, page -> {
            PageGeometry geometry = PageGeometry.of(page, 600.0, 400.0);
            Rectangle rect = geometry.toUserRect(100, 50, 200, 30);
            assertThat(rect.getLeft()).isCloseTo(50, within(0.001f));
            assertThat(rect.getBottom()).isCloseTo(100, within(0.001f));
            assertThat(rect.getWidth()).isCloseTo(30, within(0.001f));
            assertThat(rect.getHeight()).isCloseTo(200, within(0.001f));
        });
    }

    @Test
    void cropBoxOutsideTheMediaBoxFallsBackToTheMediaBox() {
        withPage(0, new Rectangle(1000, 1000, 100, 100), page ->
                assertPoint(PageGeometry.of(page, 400.0, 600.0).toUser(0, 0), 0, 600));
        withPage(0, new Rectangle(-50, -50, 600, 800), page ->
                assertPoint(PageGeometry.of(page, 400.0, 600.0).toUser(0, 0), 0, 600));
    }

    @Test
    void unusualRotationValuesAreNormalised() {
        withPage(-90, null, page -> {
            PageGeometry geometry = PageGeometry.of(page, 600.0, 400.0);
            assertPoint(geometry.toUser(0, 0), 400, 600);
        });
        withPage(45, null, page -> assertPoint(PageGeometry.of(page, 400.0, 600.0).toUser(0, 0), 0, 600));
    }

    @Test
    void textDirectionFollowsTheRotation() {
        int[] rotations = {0, 90, 180, 270};
        double[][] expected = {{1, 0}, {0, 1}, {-1, 0}, {0, -1}};
        for (int i = 0; i < rotations.length; i++) {
            double[] direction = expected[i];
            withPage(rotations[i], null, page -> {
                double[] along = PageGeometry.of(page, null, null).direction(1, 0);
                assertPoint(along, direction[0], direction[1]);
            });
        }
    }

    @Test
    void displacementsAreMappedWithoutTheirPositionAndScaledToPoints() {
        withPage(90, null, page -> {
            PageGeometry geometry = PageGeometry.of(page, 1200.0, 800.0); // 2 client units per point
            // 90° clockwise: displayed right is user up and displayed down is user right.
            assertPoint(geometry.vector(100, 0), 0, 50);
            assertPoint(geometry.vector(0, 100), 50, 0);
        });
        withPage(0, null, page -> assertPoint(PageGeometry.of(page, 800.0, 1200.0).vector(100, 40), 50, -20));
    }

    @Test
    void directionsHaveUnitLengthAndTheZeroVectorStaysZero() {
        withPage(270, null, page -> {
            PageGeometry geometry = PageGeometry.of(page, 1200.0, 800.0);
            double[] direction = geometry.direction(30, 40);
            assertThat(Math.hypot(direction[0], direction[1])).isCloseTo(1, within(1e-9));
            assertPoint(geometry.direction(0, 0), 0, 0);
        });
    }
}
