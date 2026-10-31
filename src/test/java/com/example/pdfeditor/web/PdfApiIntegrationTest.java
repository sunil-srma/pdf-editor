package com.example.pdfeditor.web;

import com.example.pdfeditor.service.PdfFixtures;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.websocket.ContainerProvider;
import jakarta.websocket.WebSocketContainer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PdfApiIntegrationTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ObjectMapper mapper;

    private static Map<String, Object> erase(int page) {
        return Map.of("type", "erase", "page", page, "x", 10, "y", 10, "width", 50, "height", 20,
                "pageWidth", 612, "pageHeight", 792);
    }

    private static Map<String, Object> addText(String text) {
        return Map.of("type", "addText", "page", 1, "x", 10, "y", 40, "text", text, "fontSize", 12,
                "pageWidth", 612, "pageHeight", 792);
    }

    private static Map<String, Object> request(byte[] pdf, Map<String, Object>... edits) {
        return Map.of("pdfBase64", PdfFixtures.base64(pdf), "edits", List.of(edits));
    }

    private ResponseEntity<byte[]> post(String path, Object body, String accept) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (accept != null) {
            headers.set(HttpHeaders.ACCEPT, accept);
        }
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, headers), byte[].class);
    }

    private JsonNode json(ResponseEntity<byte[]> response) throws Exception {
        return mapper.readTree(response.getBody());
    }

    // ------------------------------------------------------------------ REST

    @Test
    @SuppressWarnings("unchecked")
    void applyReturnsTheEditedPdfAsAnAttachment() {
        ResponseEntity<byte[]> response = post("/api/apply", request(PdfFixtures.letter(), erase(1)), null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_PDF);
        assertThat(response.getHeaders().getContentDisposition().getFilename()).isEqualTo("edited.pdf");
        assertThat(response.getHeaders().containsKey(PdfController.WARNINGS_HEADER)).isFalse();
        assertThat(new String(response.getBody(), 0, 5, StandardCharsets.ISO_8859_1)).isEqualTo("%PDF-");
    }

    @Test
    @SuppressWarnings("unchecked")
    void charactersNoFontCanDrawAreReportedInAWarningsHeader() throws Exception {
        ResponseEntity<byte[]> response = post("/api/apply",
                request(PdfFixtures.letter(), addText("中文")), null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        String header = response.getHeaders().getFirst(PdfController.WARNINGS_HEADER);
        assertThat(header).isNotNull();
        assertThat(header).doesNotContain("+").contains("%20");
        JsonNode warnings = mapper.readTree(URLDecoder.decode(header, StandardCharsets.UTF_8));
        assertThat(warnings.isArray()).isTrue();
        assertThat(warnings.get(0).asText()).contains("中");
    }

    @Test
    @SuppressWarnings("unchecked")
    void invalidEditsAreAnsweredWithAProblemDetailThatNamesTheCause() throws Exception {
        ResponseEntity<byte[]> response = post("/api/apply", request(PdfFixtures.letter(), erase(7)), null);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getHeaders().getContentType().toString()).startsWith("application/problem+json");
        assertThat(json(response).get("detail").asText()).contains("Edit 1 (erase)", "page 7 does not exist");
    }

    @Test
    @SuppressWarnings("unchecked")
    void errorsStayReadableWhenTheClientOnlyAcceptsPdf() throws Exception {
        ResponseEntity<byte[]> response = post("/api/apply", request(PdfFixtures.letter(), erase(7)),
                "application/pdf");

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(json(response).get("detail").asText()).contains("page 7 does not exist");
    }

    @Test
    void malformedAndIncompleteBodiesAreBadRequests() throws Exception {
        ResponseEntity<byte[]> malformed = post("/api/apply", "{not json", null);
        assertThat(malformed.getStatusCode().value()).isEqualTo(400);
        assertThat(json(malformed).get("detail").asText()).contains("not valid JSON");

        ResponseEntity<byte[]> incomplete = post("/api/apply", Map.of("pdfBase64", "AAAA"), null);
        assertThat(incomplete.getStatusCode().value()).isEqualTo(400);
        assertThat(json(incomplete).get("detail").asText()).contains("edits");
    }

    @Test
    void standardSpringErrorsKeepTheirStatus() {
        ResponseEntity<byte[]> wrongMethod = rest.getForEntity("/api/apply", byte[].class);
        assertThat(wrongMethod.getStatusCode().value()).isEqualTo(405);

        ResponseEntity<byte[]> wrongType = rest.exchange("/api/apply", HttpMethod.POST,
                new HttpEntity<>("x", textHeaders()), byte[].class);
        assertThat(wrongType.getStatusCode().value()).isEqualTo(415);
    }

    private static HttpHeaders textHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.TEXT_PLAIN);
        return headers;
    }

    @Test
    @SuppressWarnings("unchecked")
    void applySingleAppliesEveryEditAndReturnsJson() throws Exception {
        ResponseEntity<byte[]> response = post("/api/apply-single",
                request(PdfFixtures.letter(), erase(1), addText("Hello")), null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        JsonNode body = json(response);
        byte[] pdf = Base64.getDecoder().decode(body.get("pdfBase64").asText());
        assertThat(new String(pdf, 0, 5, StandardCharsets.ISO_8859_1)).isEqualTo("%PDF-");
        assertThat(body.get("warnings").isArray()).isTrue();
    }

    @Test
    @SuppressWarnings("unchecked")
    void documentsLargerThanJacksonsDefaultStringLimitAreAccepted() {
        // Base64 of a 16 MB PDF is ~21.4 million characters, above Jackson's default limit of 20 million.
        byte[] large = PdfFixtures.paddedPdf(16 * 1024 * 1024);

        ResponseEntity<byte[]> response = post("/api/apply", request(large, erase(1)), null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().length).isGreaterThan(16 * 1024 * 1024);
    }

    // ----------------------------------------------------------------- fonts

    @Test
    void fontsListsTheStandardAndTheBundledFamilies() throws Exception {
        ResponseEntity<byte[]> response = rest.getForEntity("/api/fonts", byte[].class);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        JsonNode families = json(response).get("families");
        assertThat(families.get(0).get("id").asText()).isEqualTo("sans");
        assertThat(families.get(0).get("standard").asBoolean()).isTrue();
        assertThat(families.get(0).has("webFamily")).isFalse();
        assertThat(families.get(1).get("id").asText()).isEqualTo("serif");
        assertThat(families.get(2).get("id").asText()).isEqualTo("mono");
        JsonNode openSans = null;
        for (JsonNode family : families) {
            if (family.get("id").asText().equals("opensans")) {
                openSans = family;
            }
        }
        assertThat(openSans).isNotNull();
        assertThat(openSans.get("label").asText()).isEqualTo("Open Sans");
        assertThat(openSans.get("category").asText()).isEqualTo("sans");
        assertThat(openSans.get("standard").asBoolean()).isFalse();
        assertThat(openSans.get("webFamily").asText()).isEqualTo("pdfedit-opensans");
        assertThat(openSans.get("css").asText()).startsWith("\"pdfedit-opensans\"");
        assertThat(openSans.get("faces").get("boldItalic").asText()).isEqualTo("OpenSans-BoldItalic.ttf");
    }

    @Test
    void bundledFontFilesAreServedWithTheirMediaTypeAndCaching() {
        ResponseEntity<byte[]> truetype = rest.getForEntity("/api/fonts/files/OpenSans-Regular.ttf", byte[].class);
        ResponseEntity<byte[]> opentype = rest.getForEntity("/api/fonts/files/DancingScript-Bold.otf", byte[].class);

        assertThat(truetype.getStatusCode().value()).isEqualTo(200);
        assertThat(truetype.getHeaders().getContentType().toString()).isEqualTo("font/ttf");
        assertThat(truetype.getHeaders().getCacheControl()).contains("max-age=86400").contains("public");
        assertThat(truetype.getBody().length).isGreaterThan(10_000);
        assertThat(new String(opentype.getBody(), 0, 4, StandardCharsets.ISO_8859_1)).isEqualTo("OTTO");
        assertThat(opentype.getHeaders().getContentType().toString()).isEqualTo("font/otf");
    }

    @Test
    void onlyFontsOfTheCatalogAreServed() {
        assertThat(rest.getForEntity("/api/fonts/files/Missing-Regular.ttf", byte[].class).getStatusCode().value())
                .isEqualTo(404);
        assertThat(rest.getForEntity("/api/fonts/files/NOTICE.txt", byte[].class).getStatusCode().value())
                .isEqualTo(404);
        assertThat(rest.getForEntity("/api/fonts/files/..%2F..%2Fapplication.properties", byte[].class)
                .getStatusCode().is4xxClientError()).isTrue();
    }

    @Test
    @SuppressWarnings("unchecked")
    void styledAndRotatedBlocksTravelThroughTheJsonApi() {
        Map<String, Object> block = Map.ofEntries(
                Map.entry("type", "addText"), Map.entry("page", 1), Map.entry("x", 100), Map.entry("y", 100),
                Map.entry("text", "Block\nof text"), Map.entry("fontSize", 16), Map.entry("fontFamily", "opensans"),
                Map.entry("bold", true), Map.entry("color", "#336699"), Map.entry("rotation", 30),
                Map.entry("align", "center"), Map.entry("boxWidth", 200), Map.entry("lineHeight", 1.5),
                Map.entry("underline", true), Map.entry("strikethrough", true), Map.entry("opacity", 0.8),
                Map.entry("pageWidth", 612), Map.entry("pageHeight", 792));

        ResponseEntity<byte[]> response = post("/api/apply", request(PdfFixtures.letter(), block), null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(new String(response.getBody(), 0, 5, StandardCharsets.ISO_8859_1)).isEqualTo("%PDF-");
    }

    @Test
    @SuppressWarnings("unchecked")
    void invalidBlockSettingsAreBadRequestsThatNameTheField() throws Exception {
        Map<String, Object> block = Map.of("type", "addText", "page", 1, "x", 10, "y", 40, "text", "a",
                "align", "justify", "pageWidth", 612, "pageHeight", 792);

        ResponseEntity<byte[]> response = post("/api/apply", request(PdfFixtures.letter(), block), null);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(json(response).get("detail").asText()).contains("Edit 1 (addText)", "'align'");
    }

    // ------------------------------------------------------------- WebSocket

    private static final class Inbox extends TextWebSocketHandler {
        final BlockingQueue<String> messages = new LinkedBlockingQueue<>();

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            messages.add(message.getPayload());
        }
    }

    private WebSocketSession connect(Inbox inbox) throws Exception {
        WebSocketContainer container = ContainerProvider.getWebSocketContainer();
        container.setDefaultMaxTextMessageBufferSize(1024 * 1024);
        return new StandardWebSocketClient(container)
                .execute(inbox, "ws://localhost:" + port + "/ws/pdf-edit")
                .get(10, TimeUnit.SECONDS);
    }

    private JsonNode roundTrip(Map<String, Object> message) throws Exception {
        Inbox inbox = new Inbox();
        WebSocketSession session = connect(inbox);
        try {
            session.sendMessage(new TextMessage(mapper.writeValueAsString(message)));
            String reply = inbox.messages.poll(15, TimeUnit.SECONDS);
            assertThat(reply).as("a reply must always arrive").isNotNull();
            return mapper.readTree(reply);
        } finally {
            session.close();
        }
    }

    @Test
    void webSocketAppliesAnEditAndEchoesTheRequestId() throws Exception {
        Map<String, Object> message = Map.of("action", "edit", "id", "req-42",
                "pdfBase64", PdfFixtures.base64(PdfFixtures.letter()), "edit", addText("Hello"));

        JsonNode reply = roundTrip(message);

        assertThat(reply.get("action").asText()).isEqualTo("edit-result");
        assertThat(reply.get("id").asText()).isEqualTo("req-42");
        assertThat(reply.get("success").asBoolean()).isTrue();
        byte[] pdf = Base64.getDecoder().decode(reply.get("pdfBase64").asText());
        assertThat(new String(pdf, 0, 5, StandardCharsets.ISO_8859_1)).isEqualTo("%PDF-");
        assertThat(reply.get("warnings").isArray()).isTrue();
    }

    @Test
    void webSocketReportsInvalidEditsInsteadOfStayingSilent() throws Exception {
        Map<String, Object> message = Map.of("action", "edit", "id", "req-7",
                "pdfBase64", PdfFixtures.base64(PdfFixtures.letter()), "edit", erase(5));

        JsonNode reply = roundTrip(message);

        assertThat(reply.get("action").asText()).isEqualTo("error");
        assertThat(reply.get("id").asText()).isEqualTo("req-7");
        assertThat(reply.get("success").asBoolean()).isFalse();
        assertThat(reply.get("message").asText()).contains("page 5 does not exist");
    }

    @Test
    void webSocketReportsUnknownActionsAndBadJson() throws Exception {
        JsonNode unknown = roundTrip(Map.of("action", "dance"));
        assertThat(unknown.get("action").asText()).isEqualTo("error");
        assertThat(unknown.get("message").asText()).contains("Unsupported action");

        Inbox inbox = new Inbox();
        WebSocketSession session = connect(inbox);
        try {
            session.sendMessage(new TextMessage("{broken"));
            JsonNode reply = mapper.readTree(inbox.messages.poll(15, TimeUnit.SECONDS));
            assertThat(reply.get("action").asText()).isEqualTo("error");
        } finally {
            session.close();
        }
    }
}
