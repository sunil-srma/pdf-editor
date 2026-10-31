package com.example.pdfeditor.service;

/** Thrown when a request cannot be applied because of invalid input (reported as HTTP 400 / an error message). */
public class InvalidEditException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public InvalidEditException(String message) {
        super(message);
    }

    public InvalidEditException(String message, Throwable cause) {
        super(message, cause);
    }
}
