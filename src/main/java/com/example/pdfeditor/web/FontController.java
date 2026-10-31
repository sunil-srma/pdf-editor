package com.example.pdfeditor.web;

import com.example.pdfeditor.model.FontsResponse;
import com.example.pdfeditor.service.FontCatalog;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

/** Lists the fonts a text edit can use and serves the bundled font files to the browser preview. */
@RestController
@RequestMapping("/api/fonts")
public class FontController {

    private final FontCatalog fontCatalog;

    public FontController(FontCatalog fontCatalog) {
        this.fontCatalog = fontCatalog;
    }

    @GetMapping
    public FontsResponse fonts() {
        return new FontsResponse(fontCatalog.families());
    }

    /** Only files declared in the catalog are served, so the name cannot be used to read other resources. */
    @GetMapping("/files/{file}")
    public ResponseEntity<byte[]> file(@PathVariable String file) {
        return fontCatalog.read(file)
                .map(bytes -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(FontCatalog.contentType(file)))
                        .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic())
                        .body(bytes))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
