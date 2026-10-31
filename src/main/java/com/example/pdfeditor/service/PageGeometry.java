package com.example.pdfeditor.service;

import com.itextpdf.kernel.geom.Rectangle;
import com.itextpdf.kernel.pdf.PdfPage;

/**
 * Converts coordinates measured on the page as it is displayed (top-left origin, after /Rotate and
 * cropping, in client units) into PDF default user space.
 */
final class PageGeometry {

    private final double boxX;
    private final double boxY;
    private final double boxWidth;
    private final double boxHeight;
    private final int rotation;
    private final double unitsX;
    private final double unitsY;

    private PageGeometry(Rectangle box, int rotation, Double viewWidth, Double viewHeight) {
        this.boxX = box.getX();
        this.boxY = box.getY();
        this.boxWidth = box.getWidth();
        this.boxHeight = box.getHeight();
        this.rotation = rotation;
        boolean sideways = rotation == 90 || rotation == 270;
        double displayedWidth = sideways ? boxHeight : boxWidth;
        double displayedHeight = sideways ? boxWidth : boxHeight;
        this.unitsX = viewWidth != null && viewWidth > 0 ? displayedWidth / viewWidth : 1;
        this.unitsY = viewHeight != null && viewHeight > 0 ? displayedHeight / viewHeight : 1;
    }

    /**
     * @param viewWidth  width of the displayed page in client units (null means 1 unit = 1 point)
     * @param viewHeight height of the displayed page in client units
     */
    static PageGeometry of(PdfPage page, Double viewWidth, Double viewHeight) {
        Rectangle media = page.getMediaBox();
        Rectangle visible = media.getIntersection(page.getCropBox());
        if (visible == null || visible.getWidth() <= 0 || visible.getHeight() <= 0) {
            visible = media;
        }
        int rotation = ((page.getRotation() % 360) + 360) % 360;
        if (rotation % 90 != 0) {
            rotation = 0;
        }
        return new PageGeometry(visible, rotation, viewWidth, viewHeight);
    }

    /** Maps a point on the displayed page to user space. */
    double[] toUser(double x, double y) {
        double px = x * unitsX;
        double py = y * unitsY;
        return switch (rotation) {
            case 90 -> new double[]{boxX + py, boxY + px};
            case 180 -> new double[]{boxX + boxWidth - px, boxY + py};
            case 270 -> new double[]{boxX + boxWidth - py, boxY + boxHeight - px};
            default -> new double[]{boxX + px, boxY + boxHeight - py};
        };
    }

    /** Maps an axis-aligned box on the displayed page to an (also axis-aligned) user space rectangle. */
    Rectangle toUserRect(double x, double y, double width, double height) {
        double[] a = toUser(x, y);
        double[] b = toUser(x + width, y + height);
        return new Rectangle(
                (float) Math.min(a[0], b[0]),
                (float) Math.min(a[1], b[1]),
                (float) Math.abs(a[0] - b[0]),
                (float) Math.abs(a[1] - b[1]));
    }

    /** Horizontal length on the displayed page, in points. */
    double lengthX(double units) {
        return units * unitsX;
    }

    /** Vertical length on the displayed page, in points. */
    double lengthY(double units) {
        return units * unitsY;
    }

    /** Maps a displacement on the displayed page (client units) to a displacement in user space (points). */
    double[] vector(double dx, double dy) {
        double px = dx * unitsX;
        double py = dy * unitsY;
        return switch (rotation) {
            case 90 -> new double[]{py, px};
            case 180 -> new double[]{-px, py};
            case 270 -> new double[]{-py, -px};
            default -> new double[]{px, -py};
        };
    }

    /** Like {@link #vector(double, double)} but scaled to unit length; the zero vector stays zero. */
    double[] direction(double dx, double dy) {
        double[] v = vector(dx, dy);
        double length = Math.hypot(v[0], v[1]);
        return length == 0 ? v : new double[]{v[0] / length, v[1] / length};
    }
}
