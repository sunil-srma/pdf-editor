package com.example.pdfeditor.web;

import com.example.pdfeditor.model.ApplyRequest;
import com.example.pdfeditor.model.ApplyResponse;
import com.example.pdfeditor.service.PdfEditResult;
import com.example.pdfeditor.service.PdfEditService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/**
 * REST endpoints that apply a batch of edits to a PDF. Failures are translated into
 * {@code application/problem+json} responses by {@link ApiExceptionHandler}.
 */
@RestController
@RequestMapping("/api")
public class PdfController {

    /** Carries non-fatal warnings of {@code /api/apply} as a URL-encoded JSON array of strings. */
    public static final String WARNINGS_HEADER = "X-PDF-Warnings";

    private static final int MAX_WARNINGS = 10;
    private static final int MAX_WARNING_LENGTH = 200;

    private final PdfEditService pdfEditService;
    private final ObjectMapper objectMapper;

    public PdfController(PdfEditService pdfEditService, ObjectMapper objectMapper) {
        this.pdfEditService = pdfEditService;
        this.objectMapper = objectMapper;
    }

    /** Applies all edits and returns the edited PDF as a binary download. */
    @PostMapping(value = "/apply", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> applyEdits(@Valid @RequestBody ApplyRequest request) {
        PdfEditResult result = pdfEditService.applyEdits(request.pdfBase64(), request.edits());

        ResponseEntity.BodyBuilder response = ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename("edited.pdf").build().toString());
        if (!result.warnings().isEmpty()) {
            response.header(WARNINGS_HEADER, encodeWarnings(result.warnings()));
        }
        return response.body(result.pdf());
    }

    /** Applies all edits and returns the edited PDF Base64 encoded inside a JSON object. */
    @PostMapping(value = "/apply-single", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ApplyResponse applyEditsAsJson(@Valid @RequestBody ApplyRequest request) {
        PdfEditResult result = pdfEditService.applyEdits(request.pdfBase64(), request.edits());
        return new ApplyResponse(Base64.getEncoder().encodeToString(result.pdf()), result.warnings());
    }

    private String encodeWarnings(List<String> warnings) {
        List<String> shortened = warnings.stream()
                .limit(MAX_WARNINGS)
                .map(warning -> warning.length() > MAX_WARNING_LENGTH
                        ? warning.substring(0, MAX_WARNING_LENGTH) + "…"
                        : warning)
                .toList();
        try {
            // URLEncoder writes spaces as '+', which browsers' decodeURIComponent leaves alone.
            return URLEncoder.encode(objectMapper.writeValueAsString(shortened), StandardCharsets.UTF_8)
                    .replace("+", "%20");
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot serialize warnings", e);
        }
    }
}
