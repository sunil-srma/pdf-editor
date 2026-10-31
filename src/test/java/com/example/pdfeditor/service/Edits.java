package com.example.pdfeditor.service;

import com.example.pdfeditor.model.PdfEdit;

/** Fluent builder that keeps the long {@link PdfEdit} constructor out of the tests. */
final class Edits {

    private final String type;
    private int page = 1;
    private Double x;
    private Double y;
    private Double width;
    private Double height;
    private Double fontSize;
    private Double pageWidth;
    private Double pageHeight;
    private String text;
    private String imageBase64;
    private String color;
    private Double textX;
    private Double baseline;
    private Boolean bold;
    private Boolean italic;
    private String fontFamily;
    private String backgroundColor;
    private Double rotation;
    private String align;
    private Double boxWidth;
    private Double lineHeight;
    private Boolean underline;
    private Boolean strikethrough;
    private Double opacity;

    private Edits(String type) {
        this.type = type;
    }

    static Edits of(String type) {
        return new Edits(type);
    }

    static Edits replace() {
        return new Edits(PdfEdit.TYPE_REPLACE);
    }

    static Edits addText() {
        return new Edits(PdfEdit.TYPE_ADD_TEXT);
    }

    static Edits erase() {
        return new Edits(PdfEdit.TYPE_ERASE);
    }

    static Edits highlight() {
        return new Edits(PdfEdit.TYPE_HIGHLIGHT);
    }

    static Edits addImage() {
        return new Edits(PdfEdit.TYPE_ADD_IMAGE);
    }

    Edits page(int value) {
        this.page = value;
        return this;
    }

    Edits box(double bx, double by, double bw, double bh) {
        this.x = bx;
        this.y = by;
        this.width = bw;
        this.height = bh;
        return this;
    }

    Edits at(double bx, double by) {
        this.x = bx;
        this.y = by;
        return this;
    }

    Edits viewport(double w, double h) {
        this.pageWidth = w;
        this.pageHeight = h;
        return this;
    }

    Edits text(String value) {
        this.text = value;
        return this;
    }

    Edits fontSize(Double value) {
        this.fontSize = value;
        return this;
    }

    Edits origin(double originX, double originBaseline) {
        this.textX = originX;
        this.baseline = originBaseline;
        return this;
    }

    Edits color(String value) {
        this.color = value;
        return this;
    }

    Edits background(String value) {
        this.backgroundColor = value;
        return this;
    }

    Edits font(String family, boolean isBold, boolean isItalic) {
        this.fontFamily = family;
        this.bold = isBold;
        this.italic = isItalic;
        return this;
    }

    Edits image(String base64) {
        this.imageBase64 = base64;
        return this;
    }

    Edits rotation(double degrees) {
        this.rotation = degrees;
        return this;
    }

    Edits align(String value) {
        this.align = value;
        return this;
    }

    Edits boxWidth(double value) {
        this.boxWidth = value;
        return this;
    }

    Edits lineHeight(double value) {
        this.lineHeight = value;
        return this;
    }

    Edits underline() {
        this.underline = true;
        return this;
    }

    Edits strikethrough() {
        this.strikethrough = true;
        return this;
    }

    Edits opacity(double value) {
        this.opacity = value;
        return this;
    }

    PdfEdit build() {
        return new PdfEdit(type, page, x, y, width, height, fontSize, pageWidth, pageHeight, text, imageBase64,
                color, textX, baseline, bold, italic, fontFamily, backgroundColor, rotation, align, boxWidth,
                lineHeight, underline, strikethrough, opacity);
    }
}
