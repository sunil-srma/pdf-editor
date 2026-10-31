# Java PDF Editor

A web-based PDF editor built with Spring Boot (backend) and React (frontend), using iText for PDF manipulation and PDF.js for rendering in the browser.

## Features

- Open a PDF from the file picker or by dropping it onto the window
- Click any text to edit it in place; font family, weight, slant, size and colour are taken from the PDF and can be changed
- Add text and images, then move and resize them by dragging
- Erase areas and highlight them (the text stays readable under the highlight)
- Undo / redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y), zoom and fit-to-width
- Export the edited PDF, or one PNG image per page
- Large documents stay responsive: pages are rendered lazily and released again when they scroll out of view
- Rotated and cropped pages are handled; characters the PDF's own fonts lack are drawn with an installed system font

## How editing works

Edits are drawn on an overlay above the rendered pages, so every change appears instantly and nothing is sent to the server while you work. **Export PDF** sends the original file together with all edits in a single request (`POST /api/apply`) and downloads the result. Without edits the original file is downloaded unchanged. A warning is shown for content that could not be reproduced exactly, for example characters that no installed font can draw.

The browser warns before unsaved edits are discarded (closing the tab or opening another PDF). Edits that have been exported count as saved.

## Technology Stack

- **Backend**: Spring Boot 3.3.4, iText 7.2.5
- **Frontend**: React 19, PDF.js (`pdfjs-dist`) 3.11.174, Create React App
- **Build**: Maven with frontend build integration

## Development Setup

### Prerequisites

- Java 21+
- Node.js 18+
- Maven 3.6+

### Running the Application

1. Clone the repository
2. Run the full build:
   ```bash
   mvn clean install
   ```
3. Start the application:
   ```bash
   mvn spring-boot:run
   ```
   or run the packaged jar:
   ```bash
   java -jar target/java-pdf-editor-0.0.1-SNAPSHOT.jar
   ```
4. Open http://localhost:8080 in your browser

The Maven build will automatically:
- Install Node.js dependencies
- Build the React frontend
- Copy the built frontend into the application (`target/classes/static`)
- Run the backend tests

### Development Mode

For frontend development with hot reloading:

1. Start the backend:
   ```bash
   mvn spring-boot:run
   ```

2. In another terminal, start the React dev server:
   ```bash
   cd frontend
   npm start
   ```

3. The React app will run on http://localhost:3000 with hot reloading. Requests to `/api` are forwarded to the backend on port 8080 (see `"proxy"` in `frontend/package.json`).

### Tests

```bash
# Backend (JUnit); -Dexec.skip=true skips the npm install/build steps
mvn -Dexec.skip=true test

# Frontend (Jest and React Testing Library)
cd frontend
CI=true npm test -- --watchAll=false
```

To package without rebuilding the frontend, run `npm run build` once and then `mvn -Dexec.skip=true clean package`.

## Project Structure

```
java-pdf-editor/
├── src/main/java/com/example/pdfeditor/
│   ├── model/                          # Request/response DTOs (PdfEdit, ApplyRequest, ApplyResponse)
│   ├── service/                        # PdfEditService (iText), page geometry, font handling
│   ├── web/                            # REST controller, WebSocket handler, error handling
│   └── config/                         # WebSocket and Jackson configuration
├── src/test/java/                      # Backend tests
├── frontend/
│   ├── src/                            # React source (App, PdfPage, InlineTextEditor, edit model, PDF.js setup) and Jest tests
│   ├── public/
│   └── build/                          # Built output (generated, copied into target/classes/static)
├── pom.xml                             # Maven configuration
└── README.md
```

## API Endpoints

### `POST /api/apply`

Applies all edits in one request.

- Request body: JSON `{ "pdfBase64": "...", "edits": [ ... ] }`
- Response: the edited PDF (`application/pdf`, attachment `edited.pdf`). If some content could not be reproduced exactly, the header `X-PDF-Warnings` holds a URL-encoded JSON array of messages.
- Errors: `application/problem+json` with a `detail` text, status `400` for invalid input (unknown edit type, a page that does not exist, an unreadable image, ...) and `500` for anything unexpected.

### `POST /api/apply-single`

Same request, but the response is JSON: `{ "pdfBase64": "...", "warnings": [ ... ] }`.

### WebSocket `/ws/pdf-edit`

Send `{ "action": "edit", "id": "...", "pdfBase64": "...", "edit": { ... } }` (or `"edits": [ ... ]`). The answer is `{ "action": "edit-result", "id": "...", "success": true, "pdfBase64": "...", "warnings": [] }`, or `{ "action": "error", ... }`. Messages are limited to 10 MB, so use the REST endpoints for larger files. The web UI itself only uses `POST /api/apply`.

### Edits

Every edit has a `type` (`replace`, `erase`, `addText`, `addImage` or `highlight`) and a 1-based `page`. Coordinates are measured from the top-left corner of the page as it is displayed (after rotation and cropping), in the units of the viewport that produced them. `pageWidth` and `pageHeight` give the size of that viewport, so any render scale works.

| Field | Used by | Meaning |
|---|---|---|
| `x`, `y`, `width`, `height` | all | The box the edit acts on: the original text box for `replace`, the area for `erase` / `highlight`, the image box for `addImage`, the position for `addText` |
| `pageWidth`, `pageHeight` | all | Size of the viewport the coordinates refer to |
| `text` | `replace`, `addText` | The new text (up to 20,000 characters, line breaks allowed) |
| `textX`, `baseline` | `replace`, `addText` | Left edge and baseline of the first line (default: `x` and `y + fontSize`) |
| `fontSize` | `replace`, `addText` | Size in viewport units (default 12) |
| `fontFamily`, `bold`, `italic` | `replace`, `addText` | `sans` (default), `serif` or `mono`, with optional weight and slant |
| `color` | `replace`, `addText`, `highlight` | `#rgb` or `#rrggbb` (text black and highlight yellow by default) |
| `backgroundColor` | `replace`, `erase` | Colour that covers the original content (default white) |
| `imageBase64` | `addImage` | PNG or JPEG, up to 25 MB |

## Limitations

- **Replace and erase cover the original content with a filled rectangle.** The original text stays in the PDF's content stream (it can still be found by text extraction), so this is not a redaction tool.
- Replacement fonts are chosen from the standard PDF fonts (Helvetica, Times, Courier) according to what the original font looks like; the match is approximate. Characters outside WinAnsi are drawn with an installed Unicode font (for example DejaVu) when one exists. Complex scripts (Devanagari, Arabic) are not shaped, and CJK needs an installed CJK font; anything that cannot be drawn becomes `?` and is reported as a warning.
- Rotated text (text that is not horizontal on the displayed page) can be erased or highlighted but not edited.
- Password-protected PDFs cannot be opened.
- The text of a page cannot be selected or copied in the viewer.

## Troubleshooting

- **PDF fails to open with "The PDF engine could not be started"**: PDF.js needs its worker. The worker is bundled from the `pdfjs-dist` npm package (see `frontend/src/pdfjs.js`); do not load it from a static path. Rebuild the frontend if the build output is stale (`mvn clean install`).
- **Frontend cannot reach the backend in development**: start the backend on port 8080 before `npm start`.

## Contributing

1. Backend changes: Modify Java files and run `mvn -Dexec.skip=true test`
2. Frontend changes: Modify files in `frontend/src/` and run `CI=true npm test -- --watchAll=false`, then `npm run build` or use the dev server
3. Full rebuild: `mvn clean install`