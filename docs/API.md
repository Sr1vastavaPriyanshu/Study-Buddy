# Study Buddy API

All endpoints are same-origin under `/api`. JSON responses use `{"error":"..."}` for errors.

## Chat

`POST /api/chat`

```json
{
  "messages": [{"role":"user","text":"What is photosynthesis?"}],
  "mode": "explain",
  "conversationId": 1,
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "subject": "Biology",
  "stream": true
}
```

Modes: `chat`, `explain`, `quiz`, `summary`. `provider` and `model` are optional.

Streaming responses are server-sent events: conversation ID, delta chunks, then a final done event containing sources and embedding warnings. PDF sources use `filename, p. N`.

Non-streaming response:

```json
{"reply":"...","sources":["notes.pdf, p. 3"],"warnings":[],"conversationId":1}
```

## Providers

`GET /api/providers`

Returns provider labels, configured status, supported embeddings, and model names. API keys are never returned.

## Memory

- `GET /api/memory` -> `[{"id":1,"text":"I study Physics","pinned":false}]`
- `POST /api/memory` -> `{"text":"I study Physics","pinned":true}`
- `PATCH /api/memory/:id` -> `{"text":"I study Astrophysics","pinned":false}`
- `DELETE /api/memory/:id` -> `204`

Pinned memories are always selected. Other memories are selected by keyword relevance with a small cap.

## Documents

- `GET /api/documents`
- `POST /api/documents` multipart fields: `file`, optional `subject`
- `PATCH /api/documents/:id` JSON: `{"subject":"Physics"}`
- `DELETE /api/documents/:id`

Supported file types: PDF, DOCX, TXT, MD, CSV. The maximum upload size is 10 MB and the maximum chunk count is 600.

Document responses include `id`, `name`, `chunks`, `subject`, and `embeddingModel`.

## Document actions

- `POST /api/documents/:id/flashcards`
- `POST /api/documents/:id/summarize`

Both return `reply`, `sources`, and `conversationId`.

## Conversations

- `GET /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/conversations` optional JSON: `{"subject":"Physics"}`
- `PATCH /api/conversations/:id` JSON: `{"title":"Physics revision","subject":"Physics"}`
- `DELETE /api/conversations/:id`
