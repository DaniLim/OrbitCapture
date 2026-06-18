# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OrbitCapture (@Orbitcapture_bot) is a Telegram bot that takes voice messages, transcribes them with Deepgram, and structures the transcript into a formatted Markdown document using Google Gemini. The result is sent back to the user as a `.md` file attachment.

Users bring their own Deepgram and Gemini API keys (stored per-user in the database). There are no shared API keys.

## Architecture

Two Supabase Edge Functions running on Deno, connected by a database webhook:

```
Telegram → telegram-webhook → processing_queue (INSERT) → DB webhook → background-worker → Telegram
```

**`supabase/functions/telegram-webhook/index.ts`** (`verify_jwt = true`)
- Receives all Telegram updates
- `/start` → sends onboarding instructions
- `/keys DEEPGRAM_KEY GEMINI_KEY` → upserts into `user_keys` table
- Voice message → checks `user_keys`, inserts `pending` row into `processing_queue`, sends acknowledgement

**`supabase/functions/background-worker/index.ts`** (`verify_jwt = false`)
- Triggered by a Supabase DB webhook on `processing_queue` INSERT events
- Flow: mark `processing` → fetch user keys → download audio from Telegram → Deepgram transcription → Gemini structuring → send `.md` file back via `sendDocument` → mark `completed`
- On any failure: marks queue row `error` and sends a fallback message with the raw transcript

## Database Tables

- **`user_keys`**: `telegram_id` (PK), `deepgram_api_key`, `gemini_api_key`
- **`processing_queue`**: `id`, `telegram_id`, `file_id`, `status` (`pending` → `processing` → `completed` | `error`)

The DB webhook must be configured in Supabase dashboard to POST to the `background-worker` function URL on INSERT to `processing_queue`.

## Environment Variables

Required secrets set in Supabase Edge Function settings (not in `.env.local` for production):

- `SUPABASE_URL` — auto-injected by Supabase runtime
- `SUPABASE_SERVICE_ROLE_KEY` — auto-injected by Supabase runtime
- `TELEGRAM_BOT_TOKEN` — must be set manually in Supabase dashboard secrets

`.env.local` is for local dev only and is gitignored.

## Key Commands

```bash
# Deploy both functions
supabase functions deploy telegram-webhook
supabase functions deploy background-worker

# Start local Supabase stack
supabase start

# Stop local stack
supabase stop

# Tail function logs
supabase functions logs telegram-webhook --tail
supabase functions logs background-worker --tail

# Link to remote project (first time)
supabase link --project-ref <project-ref>

# Push DB changes to remote
supabase db push
```

## External APIs

- **Deepgram**: `POST https://api.deepgram.com/v1/listen` — `nova-2` model, `smart_format`, `detect_language`. Audio sent as `audio/ogg`.
- **Gemini**: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` — structured prompt turns raw transcript into Markdown.
- **Telegram Bot API**: `getFile` → download audio, `sendDocument` → deliver `.md` file, `sendMessage` → status updates.

## Important Details

- Gemini sometimes wraps output in ` ```markdown ``` ` blocks despite the prompt forbidding it — `background-worker` strips these before building the document.
- The final document structure is: structured content at top, raw transcript in a blockquote at the bottom under `## 🎙️ Raw Transcript Archive`.
- `background-worker` handles all error states by notifying the user with a fallback raw transcript so no voice note is ever silently lost.
