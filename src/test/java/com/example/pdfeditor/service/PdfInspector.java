package com.example.pdfeditor.service;

import com.itextpdf.kernel.colors.Color;
import com.itextpdf.kernel.geom.LineSegment;
import com.itextpdf.kernel.geom.Matrix;
import com.itextpdf.kernel.geom.Path;
import com.itextpdf.kernel.geom.Point;
import com.itextpdf.kernel.geom.Rectangle;
import com.itextpdf.kernel.geom.Subpath;
import com.itextpdf.kernel.geom.Vector;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfName;
import com.itextpdf.kernel.pdf.PdfObject;
import com.itextpdf.kernel.pdf.PdfReader;
import com.itextpdf.kernel.pdf.canvas.parser.EventType;
import com.itextpdf.kernel.pdf.canvas.parser.PdfCanvasProcessor;
import com.itextpdf.kernel.pdf.canvas.parser.data.IEventData;
import com.itextpdf.kernel.pdf.canvas.parser.data.ImageRenderInfo;
import com.itextpdf.kernel.pdf.canvas.parser.data.PathRenderInfo;
import com.itextpdf.kernel.pdf.canvas.parser.data.TextRenderInfo;
import com.itextpdf.kernel.pdf.canvas.parser.listener.IEventListener;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** Replays a page's content stream and records what is drawn, in drawing order, in user space. */
final class PdfInspector {

    sealed interface Item permits Text, Fill, Line, Picture {
    }

    /**
     * A shown text string; (x, y) is the start of its baseline and (endX, endY) its end. (upX, upY) is the unit
     * vector from the baseline towards the tops of the letters, which tells a mirrored line from a correct one.
     */
    record Text(String text, double x, double y, double endX, double endY, double upX, double upY,
                double fontSize, String fontName, boolean embedded, double opacity) implements Item {

        /** Writing direction in degrees, normalised to [0, 360). */
        double angle() {
            long degrees = Math.round(Math.toDegrees(Math.atan2(endY - y, endX - x)));
            return ((degrees % 360) + 360) % 360;
        }
    }

    /** A filled path; {@code blendMode} is "Normal" unless an extended graphics state changed it. */
    record Fill(Rectangle bounds, float[] rgb, String blendMode) implements Item {
    }

    /** A stroked straight line (text decorations) from (x1, y1) to (x2, y2). */
    record Line(double x1, double y1, double x2, double y2, double width, float[] rgb, double opacity)
            implements Item {
    }

    /** An image drawn with the transformation matrix [a b 0; c d 0; e f 1]. */
    record Picture(double a, double b, double c, double d, double e, double f, double opacity) implements Item {
    }

    private final List<Item> items;

    private PdfInspector(List<Item> items) {
        this.items = items;
    }

    static PdfInspector of(byte[] pdf, int pageNumber) {
        try (PdfDocument document = new PdfDocument(new PdfReader(new ByteArrayInputStream(pdf)))) {
            Collector collector = new Collector();
            new PdfCanvasProcessor(collector).processPageContent(document.getPage(pageNumber));
            return new PdfInspector(collector.items);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    List<Item> items() {
        return items;
    }

    List<Text> texts() {
        return items.stream().filter(Text.class::isInstance).map(Text.class::cast).toList();
    }

    List<Fill> fills() {
        return items.stream().filter(Fill.class::isInstance).map(Fill.class::cast).toList();
    }

    List<Line> lines() {
        return items.stream().filter(Line.class::isInstance).map(Line.class::cast).toList();
    }

    List<Picture> pictures() {
        return items.stream().filter(Picture.class::isInstance).map(Picture.class::cast).toList();
    }

    private static final class Collector implements IEventListener {
        private final List<Item> items = new ArrayList<>();

        @Override
        public void eventOccurred(IEventData data, EventType type) {
            switch (type) {
                case RENDER_TEXT -> text((TextRenderInfo) data);
                case RENDER_PATH -> fill((PathRenderInfo) data);
                case RENDER_IMAGE -> picture((ImageRenderInfo) data);
                default -> { }
            }
        }

        @Override
        public Set<EventType> getSupportedEvents() {
            return null;
        }

        private void text(TextRenderInfo info) {
            LineSegment baseline = info.getBaseline();
            Vector start = baseline.getStartPoint();
            Vector end = baseline.getEndPoint();
            Vector top = info.getAscentLine().getStartPoint();
            double upLength = Math.hypot(top.get(0) - start.get(0), top.get(1) - start.get(1));
            items.add(new Text(info.getText(), start.get(0), start.get(1), end.get(0), end.get(1),
                    (top.get(0) - start.get(0)) / upLength, (top.get(1) - start.get(1)) / upLength,
                    info.getFontSize(), info.getFont().getFontProgram().getFontNames().getFontName(),
                    info.getFont().isEmbedded(), info.getGraphicsState().getFillOpacity()));
        }

        private void fill(PathRenderInfo info) {
            if ((info.getOperation() & PathRenderInfo.STROKE) != 0 && (info.getOperation() & PathRenderInfo.FILL) == 0) {
                stroke(info);
                return;
            }
            if ((info.getOperation() & PathRenderInfo.FILL) == 0) {
                return;
            }
            Path path = info.getPath();
            Matrix ctm = info.getCtm();
            double minX = Double.MAX_VALUE;
            double minY = Double.MAX_VALUE;
            double maxX = -Double.MAX_VALUE;
            double maxY = -Double.MAX_VALUE;
            for (Subpath subpath : path.getSubpaths()) {
                for (Point point : subpath.getPiecewiseLinearApproximation()) {
                    double x = point.x * ctm.get(Matrix.I11) + point.y * ctm.get(Matrix.I21) + ctm.get(Matrix.I31);
                    double y = point.x * ctm.get(Matrix.I12) + point.y * ctm.get(Matrix.I22) + ctm.get(Matrix.I32);
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
            Color color = info.getFillColor();
            PdfObject blend = info.getGraphicsState().getBlendMode();
            items.add(new Fill(
                    new Rectangle((float) minX, (float) minY, (float) (maxX - minX), (float) (maxY - minY)),
                    color.getColorValue(),
                    blend instanceof PdfName name ? name.getValue() : null));
        }

        private void stroke(PathRenderInfo info) {
            Matrix ctm = info.getCtm();
            for (Subpath subpath : info.getPath().getSubpaths()) {
                List<Point> points = subpath.getPiecewiseLinearApproximation();
                if (points.size() < 2) {
                    continue;
                }
                Point first = points.get(0);
                Point last = points.get(points.size() - 1);
                items.add(new Line(
                        first.x * ctm.get(Matrix.I11) + first.y * ctm.get(Matrix.I21) + ctm.get(Matrix.I31),
                        first.x * ctm.get(Matrix.I12) + first.y * ctm.get(Matrix.I22) + ctm.get(Matrix.I32),
                        last.x * ctm.get(Matrix.I11) + last.y * ctm.get(Matrix.I21) + ctm.get(Matrix.I31),
                        last.x * ctm.get(Matrix.I12) + last.y * ctm.get(Matrix.I22) + ctm.get(Matrix.I32),
                        info.getLineWidth(), info.getStrokeColor().getColorValue(),
                        info.getGraphicsState().getStrokeOpacity()));
            }
        }

        private void picture(ImageRenderInfo info) {
            Matrix m = info.getImageCtm();
            items.add(new Picture(m.get(Matrix.I11), m.get(Matrix.I12), m.get(Matrix.I21), m.get(Matrix.I22),
                    m.get(Matrix.I31), m.get(Matrix.I32), info.getGraphicsState().getFillOpacity()));
        }
    }
}
