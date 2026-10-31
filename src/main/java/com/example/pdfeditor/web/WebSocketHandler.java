package com.example.pdfeditor.web;

import com.example.pdfeditor.model.PdfEdit;
import com.example.pdfeditor.service.InvalidEditException;
import com.example.pdfeditor.service.PdfEditResult;
import com.example.pdfeditor.service.PdfEditService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * WebSocket variant of the edit API (an alternative to {@code POST /api/apply}).
 * <p>
 * Request: {@code {"action":"edit","id":"optional","pdfBase64":"...","edit":{...}}} or {@code "edits":[...]}.<br>
 * Response: {@code {"action":"edit-result","id":...,"success":true,"pdfBase64":"...","warnings":[...]}} or
 * {@code {"action":"error","id":...,"success":false,"message":"..."}}. The {@code id} is echoed back.
 */
@Component
public class WebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(WebSocketHandler.class);

    private final ObjectMapper objectMapper;
    private final PdfEditService pdfEditService;

    public WebSocketHandler(ObjectMapper objectMapper, PdfEditService pdfEditService) {
        this.objectMapper = objectMapper;
        this.pdfEditService = pdfEditService;
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws IOException {
        JsonNode id = null;
        try {
            JsonNode request = objectMapper.readTree(message.getPayload());
            if (request == null || !request.isObject()) {
                throw new InvalidEditException("The message must be a JSON object.");
            }
            id = request.get("id");

            String action = request.path("action").asText("");
            if (!"edit".equals(action)) {
                throw new InvalidEditException("Unsupported action '" + action + "'.");
            }

            PdfEditResult result = pdfEditService.applyEdits(
                    PdfEditService.decodeBase64(request.path("pdfBase64").asText(null), "pdfBase64"),
                    readEdits(request));
            send(session, success(id, result));
        } catch (InvalidEditException e) {
            send(session, failure(id, e.getMessage()));
        } catch (JsonProcessingException e) {
            send(session, failure(id, "The message is not valid for this operation: " + e.getOriginalMessage()));
        } catch (Exception | LinkageError e) {
            // Always answer the client; a silent failure would leave the UI waiting forever.
            log.error("Failed to apply edit received over WebSocket", e);
            send(session, failure(id, "Failed to apply edit: " + e.getMessage()));
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.warn("WebSocket transport error on session {}: {}", session.getId(), exception.toString());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        log.debug("WebSocket session {} closed: {}", session.getId(), status);
    }

    private List<PdfEdit> readEdits(JsonNode request) throws JsonProcessingException {
        JsonNode single = request.get("edit");
        JsonNode many = request.get("edits");
        List<PdfEdit> edits = new ArrayList<>();
        if (single != null && !single.isNull()) {
            edits.add(objectMapper.treeToValue(single, PdfEdit.class));
        }
        if (many != null && many.isArray()) {
            for (JsonNode node : many) {
                edits.add(objectMapper.treeToValue(node, PdfEdit.class));
            }
        }
        return edits;
    }

    private ObjectNode success(JsonNode id, PdfEditResult result) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("action", "edit-result");
        response.set("id", id);
        response.put("success", true);
        response.put("pdfBase64", Base64.getEncoder().encodeToString(result.pdf()));
        ArrayNode warnings = response.putArray("warnings");
        result.warnings().forEach(warnings::add);
        return response;
    }

    private ObjectNode failure(JsonNode id, String message) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("action", "error");
        response.set("id", id);
        response.put("success", false);
        response.put("message", message);
        return response;
    }

    // A session may not be written to by several threads at the same time.
    private void send(WebSocketSession session, ObjectNode payload) throws IOException {
        if (!session.isOpen()) {
            return;
        }
        String json = objectMapper.writeValueAsString(payload);
        synchronized (session) {
            session.sendMessage(new TextMessage(json));
        }
    }
}
