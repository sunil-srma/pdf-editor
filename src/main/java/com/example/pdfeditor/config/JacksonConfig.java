package com.example.pdfeditor.config;

import com.fasterxml.jackson.core.StreamReadConstraints;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class JacksonConfig {

    /**
     * PDFs travel as Base64 strings inside JSON. Jackson's default limit of 20 million characters would reject
     * PDFs larger than roughly 15 MB, so it is raised to about 100 MB of PDF data.
     */
    private static final int MAX_BASE64_CHARS = 140_000_000;

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer base64LengthCustomizer() {
        return builder -> builder.postConfigurer(mapper -> mapper.getFactory().setStreamReadConstraints(
                StreamReadConstraints.builder().maxStringLength(MAX_BASE64_CHARS).build()));
    }
}
