# GitHub Copilot Instructions for Java PDF Editor

## Project Overview

Java PDF Editor is a full-stack web application for editing PDF files. It combines:
- **Backend**: Spring Boot 3.3.4 with iText for PDF manipulation
- **Frontend**: React 19 with PDF.js 3.11.174 for PDF rendering
- **Build**: Maven with integrated frontend build pipeline

## Architecture & Code Organization

### Backend Structure (`src/main/java/com/example/pdfeditor/`)
- **Controllers**: REST endpoints for PDF operations
- **Services**: Business logic for PDF manipulation using iText
- **Models**: Data transfer objects (DTOs) for request/response handling
- **Resources**: Static assets (built React frontend)

### Frontend Structure (`frontend/src/`)
- **App.js**: Main component: opening documents, toolbar, edit history (undo/redo), export
- **PdfPage.js**: One page: lazy canvas rendering, SVG edit layer, pointer gestures, in-place editor
- **InlineTextEditor.js**: The text editor that opens on top of a page
- **editModel.js**: Edit objects, the history reducer and the payload sent to the backend
- **pdfText.js / fonts.js**: Text hit-testing, colour sampling and font detection for PDF.js text
- **pdfjs.js**: The shared PDF.js worker and `openDocument`
- **api.js**: Client for `POST /api/apply`, error and warning handling
- **App.css**: Styling for the PDF editor interface
- **public/pdfjs**: PDF.js CMaps and standard font data (not the worker)

## Key Technologies & Patterns

### Backend (Java/Spring Boot)
- **REST API**: JSON request/response format
- **PDF Handling**: iText library for PDF manipulation
- **Endpoints**: Primarily POST-based for PDF operations
- **Response Format**: Use appropriate HTTP status codes and error messages

### Frontend (React)
- **PDF.js Integration**: Use `pdfjs-dist` npm package
- **Worker Configuration**: The worker comes from the npm package, not from a static path, and is bundled by webpack as a real worker (see `frontend/src/pdfjs.js`)
  ```javascript
  const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url));
  const worker = new pdfjsLib.PDFWorker({ port });
  pdfjsLib.getDocument({ data: bytes, worker });
  ```
  Do not set `GlobalWorkerOptions.workerSrc` to an imported file: Create React App runs it through Babel and the worker then fails with `require is not defined`.
- **State Management**: React hooks (useState, useRef, and useReducer for the edit history)
- **Canvas Rendering**: PDF pages rendered to HTML5 canvas

## Coding Conventions

### Java/Spring Boot
- Use `@RestController` for REST endpoints
- Create separate service classes for business logic
- Use DTOs for API request/response bodies
- Include proper exception handling with meaningful error messages
- Follow Spring naming conventions for beans and controllers
- Format: camelCase for method/variable names, PascalCase for classes

### React/JavaScript
- Functional components with React hooks
- Use `useRef` for DOM references, `useState` for state
- Import PDF.js utilities: `import * as pdfjsLib from 'pdfjs-dist'`
- Handle async operations with proper error catching
- Use descriptive variable names and add comments for complex logic

## Common Tasks & Workflows

### Adding a New PDF Feature
1. **Backend**: Create a new endpoint in controller, add logic to service
2. **Frontend**: Add UI component and call the new endpoint
3. **Testing**: Test with sample PDFs of various sizes

### Modifying PDF Editing Tools
- The active tool is the `tool` state in `App.js`
- Edit operations live in the undo/redo history (`historyReducer` in `editModel.js`); never mutate an edit, replace it so unchanged edits keep their identity
- Canvas elements represent individual pages; edits are drawn on an SVG layer above each canvas
- Coordinate system: PDF.js viewport at scale 1 (origin top-left, after rotation and cropping), so edits do not depend on the zoom level

### API Communication
- **Endpoint Pattern**: `POST /api/{operation}`
- **Request Format**: JSON with `pdfBase64` and operation-specific data
- **Response**: Binary PDF blob (with an optional `X-PDF-Warnings` header) or an `application/problem+json` error with a `detail` message

## Important Implementation Details

### PDF.js Worker Loading
- **Always** take the worker from the npm package (through `new Worker(new URL(...))` in `pdfjs.js`), not from the public folder
- Worker is required for PDF rendering to function properly
- Without proper worker configuration, PDF.js will fail silently or throw errors

### PDF Edit Operations
- Edits are kept in memory as overlays (with undo/redo) and applied in a single request when the user exports
- Each edit contains: type, coordinates, page number, content
- Applied edits require server-side PDF manipulation via iText (`PdfEditService`, shared by REST and WebSocket)
- Result is downloaded as binary blob
- Keep the edit fields in `frontend/src/editModel.js` (`toPayload`) and `model/PdfEdit.java` in sync

### State Management
- Page viewports stored for coordinate mapping
- Original PDF bytes retained for reset/retry; PDF.js takes ownership of the buffer it is given, so always pass it a copy
- Pages are rendered lazily and released when far off-screen, which keeps large documents responsive

## Build & Deployment

### Local Development
```bash
# Full build (backend + frontend)
mvn clean install

# Run application
mvn spring-boot:run

# Frontend hot-reload (separate terminal)
cd frontend && npm start
```

### Production Build
- Maven automatically handles React build integration
- Built frontend copied to Spring Boot resources
- Single JAR deployment includes both backend and frontend

## Testing Guidelines

### Backend Testing
- Unit tests for service layer
- Integration tests for REST endpoints
- Prefer real iText round trips (generate a small PDF, apply edits, read it back) over mocking iText
- Run with `mvn -Dexec.skip=true test`

### Frontend Testing
- Component tests with React Testing Library
- Mock PDF.js in tests: `jest.mock('./pdfjs', ...)`, because `pdfjs.js` uses `import.meta`, which Jest cannot parse
- Test canvas rendering and user interactions
- Run with `cd frontend && CI=true npm test -- --watchAll=false`

## Common Issues & Solutions

### PDF.js Worker Error
**Issue**: "pdf.worker.js not found", `require is not defined`, or PDF fails to load
**Solution**: Ensure the worker is created from the npm package as in `frontend/src/pdfjs.js`, not from a static path or `workerSrc`

### CORS Issues
**Issue**: Frontend cannot reach backend API
**Solution**: Check Spring Boot CORS configuration in backend

### PDF Rendering Blank
**Issue**: PDF loads but canvas is empty
**Solution**: Verify PDF.js worker is properly configured, check console for errors

## Performance Considerations

- Large PDFs: Consider pagination or lazy loading pages
- Canvas rendering: Scale factor affects memory usage
- Image uploads: Validate file size before processing
- Text layer: May cause performance impact on large documents

## Dependencies to Know

### Key Backend Dependencies
- `org.springframework.boot:spring-boot-starter-web`
- `com.itextpdf:itext7-core`

### Key Frontend Dependencies
- `react@^19.2.4`
- `pdfjs-dist@^3.11.174`
- `react-scripts@5.0.1`

## Git Workflow

- Branch names: `feature/description` or `bugfix/description`
- Commit messages: Clear, descriptive, and reference issues when applicable
- Pull requests: Include description of changes and testing notes

## Documentation

- **README.md**: Setup and quick start guide
- **Inline comments**: Explain complex algorithms and logic
- **JSDoc**: Document JavaScript functions with parameter and return types
- **JavaDoc**: Document public Java classes and methods

---

When writing code for this project, follow these principles:
1. **Simplicity**: Keep code straightforward and maintainable
2. **Error Handling**: Provide clear error messages to users
3. **Performance**: Consider memory usage with large PDFs
4. **Consistency**: Follow existing code patterns in the project
5. **Accessibility**: Ensure UI is keyboard navigable and screen reader friendly
