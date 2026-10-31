package com.example.pdfeditor.service;

import com.itextpdf.io.font.constants.StandardFonts;
import com.itextpdf.kernel.font.PdfFontFactory;
import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.geom.Rectangle;
import com.itextpdf.kernel.pdf.EncryptionConstants;
import com.itextpdf.kernel.pdf.CompressionConstants;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfName;
import com.itextpdf.kernel.pdf.PdfPage;
import com.itextpdf.kernel.pdf.PdfStream;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.kernel.pdf.WriterProperties;
import com.itextpdf.kernel.pdf.canvas.PdfCanvas;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Random;

/** Builds small PDFs and images for the tests. */
public final class PdfFixtures {

    private PdfFixtures() {
    }

    /** One text line "Original" at user space (50, 50) on every page. */
    static byte[] pdf(int pages, PageSize size, int rotation, Rectangle cropBox) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (PdfDocument document = new PdfDocument(new PdfWriter(out))) {
            for (int i = 0; i < pages; i++) {
                PdfPage page = document.addNewPage(size);
                if (rotation != 0) {
                    page.setRotation(rotation);
                }
                if (cropBox != null) {
                    page.setCropBox(cropBox);
                }
                new PdfCanvas(page)
                        .beginText()
                        .setFontAndSize(PdfFontFactory.createFont(StandardFonts.HELVETICA), 12)
                        .moveText(50, 50)
                        .showText("Original")
                        .endText();
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }

    public static byte[] letter() {
        return pdf(1, PageSize.LETTER, 0, null);
    }

    /** Independent inverse of the backend mapping: user space to the displayed page in points (y down). */
    static double[] toDisplay(int rotation, Rectangle visibleBox, double ux, double uy) {
        return switch (rotation) {
            case 90 -> new double[]{uy - visibleBox.getBottom(), ux - visibleBox.getLeft()};
            case 180 -> new double[]{visibleBox.getRight() - ux, uy - visibleBox.getBottom()};
            case 270 -> new double[]{visibleBox.getTop() - uy, visibleBox.getRight() - ux};
            default -> new double[]{ux - visibleBox.getLeft(), visibleBox.getTop() - uy};
        };
    }

    public static String base64(byte[] bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }

    static byte[] encrypted(String userPassword) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        WriterProperties properties = new WriterProperties().setStandardEncryption(
                userPassword.getBytes(StandardCharsets.UTF_8), "owner".getBytes(StandardCharsets.UTF_8),
                EncryptionConstants.ALLOW_PRINTING, EncryptionConstants.ENCRYPTION_AES_128);
        try (PdfDocument document = new PdfDocument(new PdfWriter(out, properties))) {
            document.addNewPage();
        }
        return out.toByteArray();
    }

    /** A valid one-page PDF that carries {@code padding} bytes of incompressible data. */
    public static byte[] paddedPdf(int padding) {
        byte[] noise = new byte[padding];
        new Random(42).nextBytes(noise);
        ByteArrayOutputStream out = new ByteArrayOutputStream(padding + 4096);
        try (PdfDocument document = new PdfDocument(new PdfWriter(out))) {
            document.addNewPage();
            PdfStream stream = new PdfStream(noise, CompressionConstants.NO_COMPRESSION);
            document.getCatalog().put(new PdfName("Padding"), stream.makeIndirect(document));
        }
        return out.toByteArray();
    }

    public static byte[] png(int width, int height) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < width; x++) {
            for (int y = 0; y < height; y++) {
                image.setRGB(x, y, new Color(200, 30, 30).getRGB());
            }
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            ImageIO.write(image, "png", out);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }
}
