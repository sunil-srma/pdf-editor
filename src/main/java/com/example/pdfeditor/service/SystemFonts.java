package com.example.pdfeditor.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.FileVisitOption;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * Lazily indexes the TrueType/OpenType fonts installed on the machine. They are only needed when an
 * edit contains characters the built-in PDF fonts cannot draw (for example the rupee sign).
 */
@Component
public class SystemFonts {

    private static final Logger log = LoggerFactory.getLogger(SystemFonts.class);
    private static final int MAX_DEPTH = 6;

    private volatile Map<String, Path> index;

    /** @param fileName font file name, compared case-insensitively (for example "DejaVuSans.ttf") */
    public Optional<Path> find(String fileName) {
        return Optional.ofNullable(index().get(fileName.toLowerCase(Locale.ROOT)));
    }

    private Map<String, Path> index() {
        Map<String, Path> local = index;
        if (local == null) {
            synchronized (this) {
                local = index;
                if (local == null) {
                    local = scan();
                    index = local;
                }
            }
        }
        return local;
    }

    private static Map<String, Path> scan() {
        Map<String, Path> found = new HashMap<>();
        for (Path directory : fontDirectories()) {
            if (!Files.isDirectory(directory)) {
                continue;
            }
            try (Stream<Path> files = Files.walk(directory, MAX_DEPTH, FileVisitOption.FOLLOW_LINKS)) {
                files.filter(Files::isRegularFile).forEach(file -> {
                    String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
                    if (name.endsWith(".ttf") || name.endsWith(".otf")) {
                        found.putIfAbsent(name, file);
                    }
                });
            } catch (IOException | UncheckedIOException | SecurityException e) {
                log.debug("Could not fully scan font directory {}: {}", directory, e.getMessage());
            }
        }
        log.debug("Indexed {} system font files", found.size());
        return found;
    }

    private static List<Path> fontDirectories() {
        String home = System.getProperty("user.home", "");
        String windowsDir = System.getenv("WINDIR");
        return List.of(
                Path.of("/usr/share/fonts"),
                Path.of("/usr/local/share/fonts"),
                Path.of(home, ".fonts"),
                Path.of(home, ".local", "share", "fonts"),
                Path.of("/Library/Fonts"),
                Path.of("/System/Library/Fonts"),
                Path.of(home, "Library", "Fonts"),
                Path.of(windowsDir != null ? windowsDir : "C:\\Windows", "Fonts"));
    }
}
